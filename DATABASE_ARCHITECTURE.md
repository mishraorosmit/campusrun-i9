# Campus Run (Project I9) — PostgreSQL + PostGIS Database Architecture Specification

> **Status:** Phase 03 Complete — PostgreSQL + PostGIS Implementation Audited & Hardened  
> **Database Engine:** PostgreSQL 16+ with PostGIS 3.4+ Extension  
> **Coordinate System:** WGS 84 (SRID 4326) using native `GEOGRAPHY` types  
> **Timezone Standard:** UTC with `TIMESTAMPTZ`  
> **Access Pattern:** Repository Pattern with Unit-of-Work Transaction Abstraction  

---

## 1. Executive Summary & Architectural Boundaries

This document defines the authoritative database strategy, geospatial conventions, connection management, transaction handling, and migration lifecycle for **Project I9**.

### Strict Architectural Boundaries
1. **Zero Database Leakage into Domain:** The domain layer (`server/domain/`) remains 100% pure TypeScript. It has zero knowledge of SQL, PostgreSQL data types, PostGIS functions, or connection pools.
2. **Persistence Behind Ports:** Use cases interact exclusively with repository interfaces (`ISpawnRepository`, `IClaimRepository`, etc.). Concrete database implementations live strictly within `server/infrastructure/repositories/postgres/`.
3. **Dedicated Application Role:** The application connects using a restricted, non-superuser role (`i9_app_user`) with DML-only privileges (`SELECT, INSERT, UPDATE, DELETE`). DDL (schema mutations) is restricted to the migration pipeline.
4. **Campus Scale Monolith:** Optimized for high-throughput single-node PostgreSQL with connection pooling. No distributed sharding or premature multi-database setups.

---

## 2. Geospatial Architecture & Conventions

Proximity detection and boundary containment are the core game mechanics of Project I9. Campus-scale proximity verification requires sub-meter accuracy without planar projection distortion.

### 2.1 Authoritative Spatial Decisions

| Parameter | Authoritative Standard | Rationale |
| :--- | :--- | :--- |
| **Coordinate Reference System** | **WGS 84 (SRID 4326)** | Standard international GPS coordinate system used by mobile browsers and geolocation APIs. |
| **Storage Type (Points)** | **`GEOGRAPHY(Point, 4326)`** | Native spherical geodetic calculations in **meters**. Avoids degree-to-meter distortions and does not require local UTM projection transforms. |
| **Storage Type (Boundaries)** | **`GEOGRAPHY(Polygon, 4326)`** | Native spherical polygon boundary containment (`ST_Covers`, `ST_Intersects`) in meters. |
| **Distance Unit** | **Meters (`FLOAT8`)** | All game mechanics (`claimRadiusMeters`, `minSpawnDistanceMeters`) operate strictly in meters. |
| **PostGIS Functions** | `ST_DWithin`, `ST_Distance`, `ST_MakePoint`, `ST_Covers` | High-performance indexed spherical operations. |

### 2.2 Coordinate Order & Input Mapping

> [!CAUTION]
> **Coordinate Ordering Hazard:**  
> - Frontend / HTTP APIs use `{ lat, lng }` (Latitude first).  
> - PostGIS and WKT functions use `(longitude, latitude)` (`X, Y` axis order).

```
API Input (lat, lng) 
       │
       ▼
Domain Entity: Coordinates { lat: number; lng: number }
       │
       ▼
PostGIS SQL: ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
```

#### SQL Mapping Rule:
Always construct geodetic points with **Longitude as the first parameter**:
```sql
ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
```
When retrieving coordinates from PostgreSQL to hydrate domain entities:
```sql
SELECT 
  id,
  code,
  ST_Y(location::geometry) AS lat,
  ST_X(location::geometry) AS lng
FROM spawns;
```

### 2.3 Proximity Calculation Standard
Claim eligibility is verified in PostGIS using spatial index-accelerated `ST_DWithin`:
```sql
-- Checks if player location is within spawn claim radius (meters)
SELECT ST_DWithin(
  spawn.location,
  ST_SetSRID(ST_MakePoint($playerLng, $playerLat), 4326)::geography,
  spawn.claim_radius_meters
) AS is_within_radius;
```

---

## 3. Timestamp & Timezone Conventions

Ambiguous timezones lead to corrupt leaderboard rotations, missed reset schedules, and broken claim cooldowns.

### 3.1 Authoritative Time Standard

1. **Storage Type:** All database timestamp columns must use **`TIMESTAMPTZ`** (`TIMESTAMP WITH TIME ZONE`). Bare `TIMESTAMP` (without timezone) is strictly prohibited.
2. **Internal Normalization:** PostgreSQL normalizes all `TIMESTAMPTZ` values to **UTC** internally upon storage.
3. **Application Runtime:** The Node.js server process enforces UTC by setting `process.env.TZ = 'UTC'` at boot.
4. **Wire Format:** All timestamps serialized in API responses and event payloads use ISO 8601 UTC strings:
   ```
   YYYY-MM-DDTHH:mm:ss.sssZ  (e.g., "2026-09-12T17:45:00.000Z")
   ```
5. **Database Server Timezone:** The database cluster session must be configured to UTC:
   ```sql
   ALTER DATABASE campus_run SET timezone TO 'UTC';
   ```

---

## 4. Database Roles & Security Architecture

The database enforces the principle of least privilege using two dedicated roles.

```
┌────────────────────────────────────────┐
│           PostgreSQL Cluster           │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │   Superuser (postgres / dba)     │  │  --> Used ONLY to create DB & roles
│  └──────────────────┬───────────────┘  │
│                     │                  │
│       ┌─────────────┴────────────┐     │
│       ▼                          ▼     │
│  ┌───────────────┐        ┌───────────────┐
│  │  i9_migrator  │        │  i9_app_user  │
│  │  (DDL Role)   │        │  (DML Role)   │
│  └───────┬───────┘        └───────┬───────┘
│          │                        │
│          │ CREATE/ALTER/DROP      │ SELECT/INSERT/UPDATE/DELETE
│          ▼                        ▼
│  ┌────────────────────────────────────────┐
│  │       Public Schema Tables & Views     │
│  └────────────────────────────────────────┘
```

### 4.1 Role Specifications

| Role Name | Access Level | Permissions | Used By |
| :--- | :--- | :--- | :--- |
| **`i9_migrator`** | Schema Admin | `CREATE, ALTER, DROP, REFERENCES` on database `campus_run` and schema `public`. | CI/CD migration runner script before application deployment. |
| **`i9_app_user`** | Application Runtime | `SELECT, INSERT, UPDATE, DELETE` on application tables. `USAGE, SELECT, UPDATE` on sequences. | Express backend connection pool during runtime. |

### 4.2 Security Constraints
- `i9_app_user` **cannot** drop tables, alter schemas, create extensions, or truncate data.
- Passwords are provided strictly via environment variables (`DATABASE_URL`), never committed to source control.
- Application connections require SSL (`sslmode=require` or `sslmode=verify-full`) in staging and production.

---

## 5. Connection Pooling Strategy

Connection pooling is managed via `pg.Pool` (`node-postgres`) to optimize resource usage and prevent connection starvation under campus-wide concurrent bursts.

### 5.1 Authoritative Pool Configuration

```typescript
export interface DatabasePoolConfig {
  connectionString: string;
  max: number;                  // Maximum concurrent clients in pool
  min: number;                  // Minimum idle clients maintained
  idleTimeoutMillis: number;    // Time before idle client is closed
  connectionTimeoutMillis: number; // Max wait time for client acquisition
  statementTimeoutMillis: number;  // Query execution timeout
}
```

| Parameter | Production Value | Development Value | Rationale |
| :--- | :--- | :--- | :--- |
| **`max`** | `20` | `5` | Prevents exceeding PostgreSQL `max_connections` (typically 100) while supporting concurrent gameplay spikes. |
| **`min`** | `4` | `1` | Warms pool to reduce connection latency for initial requests. |
| **`idleTimeoutMillis`** | `30,000` (30s) | `10,000` (10s) | Reclaims connections during off-peak campus hours (e.g. late night). |
| **`connectionTimeoutMillis`** | `5,000` (5s) | `5,000` (5s) | Fast-fail when pool is exhausted or database is unreachable. |
| **`statement_timeout`** | `5,000` (5s) | `10,000` (10s) | Prevents unindexed or locked queries from hanging worker threads. |

### 5.2 Transaction Timeout Strategy
To prevent orphaned or leaking database locks during multi-step transactions:
```sql
SET LOCAL idle_in_transaction_session_timeout = '5000'; -- 5-second max idle time in transaction
```

### 5.3 Graceful Pool Shutdown
On application shutdown signals (`SIGTERM`, `SIGINT`):
1. Stop accepting new HTTP requests.
2. Drain in-flight queries within a 5-second grace window.
3. Call `await pool.end()` to cleanly terminate all TCP connections to PostgreSQL.

---

## 6. Transaction & Concurrency Strategy

Game mutations (such as claiming a point) involve multiple database operations that must execute with strict ACID guarantees.

### 6.1 Transaction Scenarios in Project I9
1. **Point Claim Submission:**
   - Verify spawn is still active.
   - Insert claim record in `claims`.
   - Increment `claim_count` on `spawns`.
   - Update `player` total points, season points, claims count, and last active timestamp.
   - Update weekly leaderboard cache.
   - *Failure at any step must roll back the entire transaction.*
2. **Rotation Trigger:**
   - Deactivate expired spawns (`status = 'expired'`).
   - Activate next pool of spawns (`status = 'active'`).
   - Insert new `rotations` record.

### 6.2 Unit-of-Work Transaction Abstraction
To prevent leaking `pg.PoolClient` or SQL transactions into the application services layer, an abstract transaction manager port is established:

```typescript
// server/infrastructure/database/ITransactionManager.ts
export interface ITransactionManager {
  runInTransaction<T>(work: (transactionContext: unknown) => Promise<T>): Promise<T>;
}
```

- **Isolation Level:** `READ COMMITTED` (PostgreSQL default).
- **Concurrency Guard:** Pessimistic row-level locking (`SELECT ... FOR UPDATE`) is used when updating player point balances or single-claim spawn statuses to prevent double-claim race conditions:
  ```sql
  SELECT id, status, claim_count 
  FROM spawns 
  WHERE id = $1 
  FOR UPDATE;
  ```

---

## 7. Migration Lifecycle & Strategy

Database schema evolution must be versioned, repeatable, and completely decoupled from application runtime startup.

### 7.1 Authoritative Migration Rules
1. **Zero Runtime DDL:** The application server (`server/index.ts`) **never** runs migrations or alters tables on boot.
2. **Versioned SQL Files:** Plain SQL migrations ensuring transparency and deterministic execution.
3. **Migration Directory:** `server/infrastructure/database/migrations/`
4. **Naming Convention:** Sequential UTC timestamp with snake_case descriptive name:
   ```
   YYYYMMDDHHMMSS_description.sql
   ```
   *Examples:*
   - `20260913000001_enable_postgis.sql`
   - `20260913000002_create_spawns_table.sql`
   - `20260913000003_create_players_table.sql`
   - `20260913000004_create_claims_table.sql`

### 7.2 Migration Tracking Schema
Migrations are recorded in a dedicated table executed by the `i9_migrator` role:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum VARCHAR(64) NOT NULL
);
```

### 7.3 Rollback Policy
- **Forward-Only Policy for Production:** Production migrations are forward-only. Errors are corrected via new forward migrations to preserve historical integrity.
- **Local Development Reversibility:** Complementary `.down.sql` scripts may be maintained for local schema experimentation.

---

## 8. Indexing Principles & Spatial Indexing

Indexes are designed strictly to accelerate the actual query patterns defined in the use-case layer. No speculative indexes are created.

### 8.1 Spatial Indexes (GIST)
All PostGIS geospatial queries (`ST_DWithin`, bounding box intersections) require Generalized Search Tree (**GiST**) indexes:
```sql
-- GiST spatial index on spawn locations
CREATE INDEX idx_spawns_location_gist ON spawns USING GIST (location);

-- GiST spatial index on campus zone boundary polygons
CREATE INDEX idx_zones_boundary_gist ON zones USING GIST (boundary);

-- GiST spatial index on claim coordinates (for analytics / heatmap)
CREATE INDEX idx_claims_location_gist ON claims USING GIST (location);
```

### 8.2 B-Tree Indexes for Access Paths
```sql
-- 1. Active Spawns Filter (Status + Expiration check)
CREATE INDEX idx_spawns_status_expires ON spawns (status, expires_at) WHERE enabled = true;

-- 2. Duplicate Claim Check (Player + Spawn lookup)
CREATE UNIQUE INDEX idx_claims_player_spawn ON claims (player_id, spawn_id);

-- 3. Player Claims History (Sorted by timestamp)
CREATE INDEX idx_claims_player_claimed_at ON claims (player_id, claimed_at DESC);

-- 4. Weekly Leaderboard Ordering
CREATE INDEX idx_players_season_points ON players (season_points DESC);
```

---

## 9. Implementation Plan for Database Integration (Phase 04)

The database implementation will proceed in four sequential milestones:

```
┌──────────────────────────────────────────────────────────────┐
│  Phase 04.1: Driver & Connection Pool Setup                  │
│  - Install 'pg' & '@types/pg'                                │
│  - Implement DatabasePool & Health Probe                     │
│  - Update server/config/env.ts with DB parameters            │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 04.2: Initial Migration Suite                         │
│  - Migration 001: Enable PostGIS extension                   │
│  - Migration 002: Create schema_migrations table             │
│  - Migration Runner Script (CLI)                             │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 04.3: Table Schemas & Spatial Tables                  │
│  - Migration 003: Core tables (spawns, zones, players,      │
│                   claims, rotations) with GiST indexes       │
│  - Seed script for standard campus vector data               │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 04.4: Concrete PostgreSQL Repositories                │
│  - PostgresSpawnRepository (ST_DWithin proximity)            │
│  - PostgresClaimRepository (Transaction runner)              │
│  - PostgresPlayerRepository                                  │
│  - Wire into Composition Root (server/app.ts)                │
└──────────────────────────────────────────────────────────────┘
```

---

## 10. Phase 02 Infrastructure Verification Summary

The foundational PostgreSQL + PostGIS infrastructure has been implemented, connected, and verified:

1. **Client & Connection Pool:** Implemented `DatabasePool` (`server/infrastructure/database/pool.ts`) with configurable pool boundaries (`min`, `max`, idle/connect/statement timeouts) and graceful drain shutdown on application exit.
2. **Dedicated Roles:** Application operates strictly under `i9_app_user` (verified non-superuser). Schema migrations execute under `i9_migrator`.
3. **Migration System:** Initial migration `20260913000001_enable_postgis.sql` applied successfully via `MigrationRunner` (`server/infrastructure/database/migrations/`). Idempotency verified.
4. **Transactions:** `TransactionManager` (`server/infrastructure/database/transaction.ts`) verified for atomic commits and clean rollbacks under simulated failures with session idle timeouts.
5. **Geospatial Utilities:** `PostgisGeoSql` (`server/infrastructure/database/geo.ts`) enforces `(lng, lat)` spatial ordering for SRID 4326 PostGIS functions while hydrating `{ lat, lng }` domain models.
6. **Error Normalization:** `normalizeDatabaseError` (`server/infrastructure/database/errors.ts`) maps PostgreSQL errors (`23505`, `57014`, connection failures) to `AppError` subclasses without leaking database internals.

---

## 11. Phase 03 Senior Database Engineering Audit & Hardening

A comprehensive audit was performed across all 7 architectural dimensions:

### 11.1 PostgreSQL Engine & Least Privilege
- **Version Compatibility:** Audited against PostgreSQL 18 on Windows host.
- **Least-Privilege Enforcement:** Verified `i9_app_user` has `usesuper = false`. Attempting DDL as `i9_app_user` is rejected by PostgreSQL. Schema migrations are executed strictly by `i9_migrator`.
- **Connection Exhaustion Safeguards:**
  - Configurable pool limits (`max = 20`, `min = 2`).
  - Active monitoring via `dbPool.getStats()` (`totalCount`, `idleCount`, `waitingCount`).
  - `connectionTimeoutMillis = 5000` prevents thread pool starvation.
  - `statement_timeout = 5000` eliminates hanging unindexed queries.
  - Slow query logger triggers warning if queries exceed 1,000ms.
- **Graceful Shutdown:** `server/index.ts` coordinates HTTP listener closure, in-flight request draining, and `await dbPool.shutdown()`.

### 11.2 PostGIS Spatial Integrity & Precision
- **Authoritative SRID:** Locked to **SRID 4326** (`WGS 84`).
- **Data Type Standard:** `GEOGRAPHY(Point, 4326)` for points; `GEOGRAPHY(Polygon, 4326)` for zone boundaries.
- **Campus-Scale Precision:** At latitude ~37.4°, 6 decimal places yields ~0.1m precision, exceeding GPS device accuracy (3–5m). PostGIS `ST_DWithin` geodetic distance calculations operate in exact **meters** along the spheroid.
- **Axis-Order Correctness:** PostGIS SQL functions enforce `(longitude, latitude)` (`X, Y`) order:
  `ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography`.
  Domain objects and APIs consistently maintain `{ lat, lng }`.
- **Spatial Operators:** `PostgisGeoSql` provides typed parameterized SQL generators for:
  - `makePointSql(lng, lat)`
  - `dWithinSql(col, lng, lat, radiusMeters)`
  - `distanceSql(col, lng, lat)`
  - `coversPointSql(boundaryCol, lng, lat)`
  - `withinBoundsSql(col, minLng, minLat, maxLng, maxLat)`

### 11.3 Timezone & Timestamp Canonical Standard
- **Zero Local Timezone Ambiguity:** All timestamp columns use `TIMESTAMPTZ`. PostgreSQL stores values normalized to UTC.
- **Session & Process Enforcement:**
  - Migration sets session default: `SET timezone = 'UTC';`.
  - Application runtime sets: `process.env.TZ = 'UTC'`.
  - All serialized dates use ISO 8601 UTC strings (`...Z`).

### 11.4 Migrations Architecture
- **Advisory Lock Concurrency Guard:** `MigrationRunner` acquires exclusive advisory lock `pg_advisory_lock(849201948271)` before reading or running migrations, preventing concurrent deployment race conditions.
- **Cross-Platform Checksum Normalization:** All SQL files normalize `\r\n` to `\n` prior to SHA256 hashing, guaranteeing identical checksums across Windows, macOS, and Linux.
- **Integrity Validation:** Added `validateMigrations()` to verify on-disk checksums against `schema_migrations` without applying mutations.
- **Atomic Execution:** Each migration runs inside an isolated transaction (`BEGIN ... COMMIT / ROLLBACK`).

### 11.5 Indexing Strategy
- Ready for GiST spatial indexes on future `location` and `boundary` columns.
- Foundation indexes established: `schema_migrations.version` (Primary Key B-Tree).
- Zero premature speculative indexes created.

### 11.6 Layer Separation & Monolithic Simplicity
- **Clean Inversion:** Domain layer (`server/domain/`) has **zero** PostgreSQL, PostGIS, or SQL imports.
- **Campus Scale Monolith:** Avoids microservices, distributed coordinators, sharding, or premature caching. Single pooled connection to local/managed PostgreSQL.


