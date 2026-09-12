# Campus Run (Project I9) — Backend Architecture Specification

> **Status:** Phase 03 Complete — Architecture Reviewed, Hardened & Verified  
> **Target Runtime:** Node.js (v18+) with TypeScript  
> **API Pattern:** RESTful under `/api/v1`  
> **Architectural Pattern:** Clean / Hexagonal Architecture (Ports and Adapters)  

---

## 1. Executive Summary & Framework Decision

### 1.1 Framework Selection: Express (v4.21.2)
We have evaluated **Fastify** vs. **Express** against the existing repository, dependencies, and requirements of Project I9. **Express** is chosen as the exclusive API framework.

#### Rationale:
1. **Existing Dependency Alignment:** `express` (`^4.21.2`) and `@types/express` (`^4.17.21`) are already present in `package.json` alongside `@types/node` and `tsx`. Choosing Express requires zero new dependencies or lockfile disruption.
2. **Repository Precedent:** The existing build pipeline (`clean` script: `rm -rf dist server.js`) anticipates a standard Node/Express entry point.
3. **Architectural Isolation:** Under Clean Architecture, the HTTP framework is treated strictly as an external delivery mechanism (Driving Adapter). Business logic, game rules, and repositories are completely framework-agnostic. Express serves solely to parse JSON, route URLs, and map errors.
4. **PostgreSQL/PostGIS & Realtime Simplicity:** Express integrates directly with Node's native `http.Server`, providing a straightforward path to attach a future WebSocket or Server-Sent Events (SSE) server without plugin encapsulation complexity.

---

## 2. Architectural Principles & Layer Boundaries

To ensure game rules remain uncompromised and testable, the backend strictly follows Clean Architecture:

1. **Dependency Inversion (Inward Flow):** Dependencies point strictly inward. Outer layers (HTTP, Database) know about inner layers (Services, Domain). Inner layers **never** know about outer layers.
2. **Framework Isolation:** Domain models and game logic have **zero** imports from Express, database drivers, or external frameworks.
3. **No Game Rules in API Layer:** Controllers only deserialize input, delegate to use cases, and serialize responses. Controllers never calculate points, check radii, or validate streaks.
4. **Abstract Persistence (Ports & Adapters):** All data access is mediated through abstract repository interfaces (`IPointRepository`, etc.). Business logic interacts only with interfaces, never concrete database clients.
5. **Fail-Fast Configuration:** All environment variables are validated at boot before starting the network listener.
6. **Unified Error Contract:** All errors translate into an RFC 7807-compatible structured JSON format at the middleware boundary.

---

## 3. Target Backend Folder Structure

The backend code resides entirely under `server/`, keeping a strict boundary with the frontend React application in `src/`.

```
server/
├── config/                          # Configuration & startup environment validation
│   ├── env.ts                       # Environment variable schema & validation logic
│   └── index.ts                     # Validated configuration singleton
│
├── domain/                          # Pure Enterprise Game Logic (Zero external dependencies)
│   ├── entities/                    # Rich domain entities
│   │   ├── SpawnPoint.ts            # Spawn point entity & status lifecycle
│   │   ├── Player.ts                # Player profile entity & streak logic
│   │   ├── Claim.ts                 # Claim transaction entity
│   │   ├── CampusZone.ts            # Campus zone entity
│   │   └── Rotation.ts              # Rotation cycle entity
│   ├── rules/                       # Pure domain rules & calculations
│   │   ├── GeofencingRules.ts       # Haversine / radius containment logic
│   │   ├── ClaimRules.ts            # Cooldowns, eligibility, max claim checks
│   │   ├── ScoringRules.ts          # Tier point computations & streak multipliers
│   │   └── RotationRules.ts         # Spatial density & distribution algorithms
│   ├── events/                      # Domain event definitions & contracts
│   │   ├── SpawnClaimedEvent.ts
│   │   ├── RotationTriggeredEvent.ts
│   │   ├── PlayerRankChangedEvent.ts
│   │   └── LeaderboardResetEvent.ts
│   └── types.ts                     # Core domain enums & value types
│
├── errors/                          # Centralized typed error hierarchy
│   ├── AppError.ts                  # Base application error class
│   ├── DomainError.ts               # Rule violation errors (out of range, etc.)
│   ├── NotFoundError.ts             # 404 resource errors
│   ├── ValidationError.ts          # 400 schema validation errors
│   ├── UnauthorizedError.ts         # 401/403 authentication/authorization errors
│   ├── ConflictError.ts             # 409 duplicate claim/state errors
│   └── ErrorCodes.ts                # Machine-readable error code enum
│
├── events/                          # Internal event bus abstraction
│   ├── EventBus.ts                  # In-memory publish/subscribe event emitter
│   ├── IEventBus.ts                 # Event bus interface
│   └── index.ts
│
├── repositories/                    # Data Access Ports (Interfaces only)
│   ├── ISpawnRepository.ts
│   ├── IPlayerRepository.ts
│   ├── IClaimRepository.ts
│   ├── IZoneRepository.ts
│   ├── IRotationRepository.ts
│   └── ILeaderboardRepository.ts
│
├── services/                        # Application Use Cases (Orchestration layer)
│   ├── dtos/                        # Input / Output Data Transfer Objects
│   │   ├── ClaimSpawnDTO.ts
│   │   ├── SpawnFilterDTO.ts
│   │   └── LeaderboardDTO.ts
│   ├── ClaimSpawnUseCase.ts         # Orchestrates player claim flow
│   ├── GetActiveSpawnsUseCase.ts    # Retrieves visible spawns for map bounds
│   ├── GetSpawnByIdUseCase.ts       # Retrieves single spawn point details
│   ├── RotateSpawnsUseCase.ts       # Executes scheduled or manual rotation
│   ├── GetLeaderboardUseCase.ts     # Computes weekly/all-time standings
│   ├── GetPlayerProfileUseCase.ts   # Retrieves player stats and history
│   ├── GetClaimsHistoryUseCase.ts   # Retrieves player claim records
│   ├── GetZonesUseCase.ts           # Retrieves all campus zones
│   ├── GetZoneByIdUseCase.ts        # Retrieves single campus zone
│   ├── GetAdminOverviewUseCase.ts   # Computes system admin metrics
│   └── AdminManageSpawnsUseCase.ts  # Admin spawn toggles & creation
│
├── validation/                      # Input validation schemas & middleware
│   ├── schemas/                     # Request validation schemas
│   │   ├── claimSchema.ts
│   │   ├── spawnFilterSchema.ts
│   │   └── adminSpawnSchema.ts
│   └── validateRequest.ts           # Middleware to validate params/body/query
│
├── controllers/                     # Driving Adapters: Express HTTP Controllers
│   ├── SpawnController.ts
│   ├── ClaimController.ts
│   ├── PlayerController.ts
│   ├── LeaderboardController.ts
│   ├── ZoneController.ts
│   └── AdminController.ts
│
├── routes/                          # Express Route Definitions
│   ├── v1/
│   │   ├── spawns.routes.ts
│   │   ├── claims.routes.ts
│   │   ├── player.routes.ts
│   │   ├── leaderboard.routes.ts
│   │   ├── zones.routes.ts
│   │   ├── admin.routes.ts
│   │   └── index.ts                 # Assembles all v1 sub-routers
│   └── index.ts                     # Mounts /api/v1 and health checks
│
├── middlewares/                     # Express Infrastructure Middlewares
│   ├── errorHandler.ts              # Global error handler -> standard JSON response
│   ├── requestLogger.ts             # Structured request/response logging
│   └── notFoundHandler.ts           # 404 handler for unknown endpoints
│
├── infrastructure/                  # Driven Adapters: External Systems & Drivers
│   ├── database/                    # DB connection pool (PostgreSQL / Knex / Kysely / PgPool)
│   │   ├── client.ts
│   │   └── migrations/              # Future PostGIS SQL migrations
│   ├── repositories/                # Concrete repository implementations
│   │   ├── inmemory/                # High-speed in-memory repos for tests & Phase 02
│   │   └── postgres/                # Production PostGIS-backed SQL repositories
│   └── geo/                         # Geodesy adapter (Turf.js / PostGIS spatial functions)
│       └── GeoCalculator.ts
│
├── app.ts                           # Express app configuration & middleware wiring
└── index.ts                         # Process entry point (boot, config check, listen)
```

---

## 4. Responsibility of Major Layers

```
┌───────────────────────────────────────────────────────────┐
│                     Driving Adapters                      │
│        (Express Routes, Controllers, Middlewares)         │
└─────────────────────────────┬─────────────────────────────┘
                              │ calls
                              ▼
┌───────────────────────────────────────────────────────────┐
│                   Application Services                    │
│             (Use Cases: ClaimSpawn, Rotate, etc.)         │
└──────────────┬─────────────────────────────┬──────────────┘
               │ uses                        │ calls
               ▼                             ▼
┌──────────────────────────────┐ ┌──────────────────────────┐
│      Pure Game Domain        │ │  Repository Interfaces   │
│  (Entities, Rules, Events)   │ │         (Ports)          │
└──────────────────────────────┘ └───────────▲──────────────┘
                                             │ implemented by
                                 ┌───────────┴──────────────┐
                                 │     Driven Adapters      │
                                 │ (PostgreSQL / PostGIS /  │
                                 │      In-Memory Repos)    │
                                 └──────────────────────────┘
```

| Layer | Folder | Responsibilities | Forbidden Actions |
| :--- | :--- | :--- | :--- |
| **Domain** | `server/domain/` | Encapsulates core game entities (`SpawnPoint`, `Player`, `Claim`), business rules (claim radius verification, cooldown calculations, point tier formula), and domain events. | **NO** imports of Express, database drivers, SQL, or network libraries. Pure logic only. |
| **Repositories (Ports)** | `server/repositories/` | Declares TypeScript interfaces defining how domain entities are retrieved and stored. | Must not include SQL queries or database driver code. |
| **Services (Use Cases)** | `server/services/` | Coordinates business workflows: fetches data via repositories, applies domain rules, persists results, and emits domain events. | Must not touch HTTP `req`/`res` objects or return HTTP status codes. |
| **Events** | `server/events/` | Decouples side effects (e.g. updating leaderboard, sending notifications, audit logging) via an in-memory event bus. | Handlers must not break transactional consistency for core actions. |
| **Validation** | `server/validation/` | Asserts schema correctness of HTTP parameters, queries, and request bodies before use case invocation. | Must not execute business logic or database checks. |
| **Controllers** | `server/controllers/` | Unpacks HTTP request parameters, invokes use cases with typed DTOs, and serializes DTO results into HTTP responses. | **NO** game logic, rule checks, or direct database access. |
| **Infrastructure** | `server/infrastructure/` | Implements repository interfaces using PostgreSQL/PostGIS or in-memory stores; manages database connection lifecycle. | Must not expose database-specific types into domain or services. |
| **Configuration** | `server/config/` | Loads, parses, and strictly validates environment variables on startup. | Must not allow application boot if required variables are invalid. |

---

## 5. Dependency Direction Between Layers

The dependency flow follows the strict **Clean Architecture Rule**:

1. `Controllers` depend on `Services` and `Validation`.
2. `Services` depend on `Domain` and `Repository Interfaces` (`Ports`), plus `EventBus`.
3. `Repositories (Concrete Adapters)` depend on `Repository Interfaces` (`Ports`) and `Domain Entities`.
4. `Domain` depends on **nothing**. It is the sovereign core of the application.

```
Controllers ──► Services ──► Domain Rules & Entities
                  │
                  ▼
          Repository Interfaces (Ports)
                  ▲
                  │ implements
          PostgreSQL / PostGIS Adapters
```

---

## 6. API Versioning & Route Structure

All endpoints reside under the `/api/v1` namespace.

```
/api/v1
├── /spawns
│   ├── GET  /                   # Get active spawns in campus bounding box
│   └── GET  /:id                # Get single spawn details & claim status
├── /claims
│   ├── POST /                   # Submit a spawn claim (playerId, spawnId, lat, lng)
│   └── GET  /history            # Get claim history for authenticated player
├── /players
│   ├── GET  /me                 # Get current player profile, stats & streak
│   └── PATCH /me                # Update profile settings (username, avatar)
├── /leaderboard
│   ├── GET  /weekly             # Current weekly competitive standings
│   └── GET  /all-time           # All-time leaderboard rankings
├── /zones
│   ├── GET  /                   # Get all campus zones with active spawn counts
│   └── GET  /:id                # Zone polygon and spawn density details
└── /admin
    ├── GET   /overview          # Live campus metrics & spawn count
    ├── POST  /spawns            # Create a new spawn point
    ├── PATCH /spawns/:id/toggle # Enable/disable spawn point
    ├── POST  /rotate            # Trigger immediate spawn rotation
    ├── GET   /heatmap           # Claim density coordinates for admin map
    └── POST  /reset-leaderboard # Trigger manual weekly reset
```

---

## 7. Configuration Strategy & Startup Validation

Configuration is validated synchronously on server startup via a typed validator (`server/config/env.ts`). If any required variable is missing or invalid, the process aborts immediately with a clear error report.

### Environment Variable Schema:
```typescript
export interface AppConfig {
  // Runtime
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  API_PREFIX: string;
  APP_URL: string;
  CORS_ORIGIN: string;

  // Database (PostgreSQL + PostGIS)
  DATABASE_URL?: string;
  DB_POOL_MIN: number;
  DB_POOL_MAX: number;

  // Game Engine Parameters
  ROTATION_INTERVAL_MINUTES: number;     // Default: 45
  MIN_SPAWN_DISTANCE_METERS: number;     // Default: 60
  CLAIM_RADIUS_METERS: number;           // Default: 25
  CONCURRENT_ACTIVE_SPAWNS: number;      // Default: 15
  STREAK_GRACE_HOURS: number;            // Default: 24
}
```

### Startup Safety Guard:
```typescript
// server/index.ts
import { config } from './config';

// Fails immediately before network socket binding if config invalid
console.log(`[I9 Server] Booting in ${config.NODE_ENV} on port ${config.PORT}`);
```

---

## 8. Typed Error Model & HTTP Mapping

The error system enforces a single structured error format compliant with RFC 7807 problem details.

### 8.1 Error Hierarchy
- **`AppError`** (Abstract base)
  - **`DomainError`** (HTTP 400 or 422): Rule violations (e.g. `OUT_OF_RANGE`, `SPAWN_NOT_ACTIVE`, `ALREADY_CLAIMED`, `COOLDOWN_ACTIVE`).
  - **`NotFoundError`** (HTTP 404): Resource does not exist (`SPAWN_NOT_FOUND`, `PLAYER_NOT_FOUND`).
  - **`ValidationError`** (HTTP 400): Malformed parameters, invalid lat/lng bounds.
  - **`UnauthorizedError`** (HTTP 401): Missing or invalid authentication.
  - **`ForbiddenError`** (HTTP 403): Player lacks required role (e.g. non-admin accessing `/admin`).
  - **`ConflictError`** (HTTP 409): Concurrent claim race condition.
  - **`InternalServerError`** (HTTP 500): Unhandled operational exceptions.

### 8.2 Standardized JSON Error Response
```json
{
  "success": false,
  "error": {
    "code": "OUT_OF_RANGE",
    "message": "Player coordinate is 42m away; maximum claim radius is 25m",
    "details": {
      "distanceMeters": 42.1,
      "allowedRadiusMeters": 25.0
    },
    "timestamp": "2026-09-12T17:35:00.000Z"
  }
}
```

---

## 9. Internal Domain Event Architecture

Domain events decouple the write path (e.g. claiming a spawn) from subsequent side-effects (e.g. recalculating leaderboard positions, triggering notifications, updating zone spawn counts).

### 9.1 Event Contract Interface
```typescript
export interface IDomainEvent<T = unknown> {
  eventId: string;
  eventName: string;
  occurredAt: Date;
  payload: T;
}
```

### 9.2 Core Game Event Catalog
1. **`SPAWN_CLAIMED`**:
   - `payload`: `{ claimId, spawnId, playerId, pointsAwarded, lat, lng, zoneId }`
   - *Subscribers:* Leaderboard Service (increment score), Notification Service (push alert), Heatmap Aggregator.
2. **`ROTATION_TRIGGERED`**:
   - `payload`: `{ rotationNumber, deactivatedSpawnIds, activatedSpawnIds, expiresAt }`
   - *Subscribers:* Map Cache Invalidator, Notification Service.
3. **`PLAYER_STREAK_INCREMENTED`**:
   - `payload`: `{ playerId, streakDays, totalPoints }`
   - *Subscribers:* Player Profile Service, Badge/Achievement Checker.
4. **`LEADERBOARD_RESET`**:
   - `payload`: `{ resetTimestamp, previousWinnerId, archiveId }`
   - *Subscribers:* Notification Broadcast, Historical Archive Service.

### 9.3 In-Memory Event Bus
For Phase 01/02, an asynchronous in-memory `DomainEventBus` operates within the Node process without introducing Redis or messaging queues. The interface guarantees seamless transition to Redis Streams / PubSub if multi-instance clustering is added in later phases.

---

## 10. Compatibility with PostgreSQL + PostGIS & Realtime Layer

- **Spatial Computations:**
  - In Phase 01/02, domain rules utilize Turf.js calculation adapters via `IGeoCalculator`.
  - In Phase 04, the `PostgresSpawnRepository` will delegate spatial queries directly to PostGIS (`ST_DWithin`, `ST_MakePoint`, `ST_Distance`).
  - Authoritative database, geospatial, and connection pool specifications are documented in [DATABASE_ARCHITECTURE.md](file:///e:/PROJECTS/Campus-Run/campus-run-/DATABASE_ARCHITECTURE.md).
  - Because `ISpawnRepository` encapsulates query methods, use cases will remain 100% unchanged when swapping between in-memory and PostGIS implementations.
- **Future Realtime Layer:**
  - Because Express runs on Node's native HTTP server, WebSocket (ws/socket.io) or Server-Sent Events (SSE) handlers will attach directly to `server.ts`.
  - The `EventBus` already broadcasts domain events (`SPAWN_CLAIMED`, `ROTATION_TRIGGERED`), allowing a future WebSocket Gateway to subscribe to domain events and forward them to connected clients with zero modifications to business logic.

---

## 11. Implementation Sequence for Subsequent Phases

| Phase | Title | Scope & Status |
| :--- | :--- | :--- |
| **Phase 01** | **Architecture & Foundation** | *(Complete)* Establish architecture, Clean Architecture boundaries, folder structure, config validator, error model, and event contracts. |
| **Phase 02** | **Architecture Skeleton & Wiring** | *(Complete)* Application bootstrap, `/api/v1` routing, thin controllers, use case orchestration, domain entities & rules, repository ports & in-memory adapters, fail-fast config, and typed error system. |
| **Phase 03** | **Architecture Review & Hardening** | *(Complete)* Architectural audit: eliminated direct repository access in controllers via dedicated use cases; isolated error classes; hardened validation with type coercion; unified 404 handling into central RFC 7807 error handler; verified startup, linting, and routing. |
| **Phase 04** | **PostgreSQL + PostGIS Persistence** | Configure database client, schema migrations (spawns with `geometry(Point, 4326)`, spatial indexing with `GIST`), and concrete SQL repositories. |
| **Phase 05** | **Authentication & Role Guards** | Implement player session/token handling, player identity resolution, and Admin role middleware (`requireRole('admin')`). |
| **Phase 06** | **Realtime & Production Readiness** | Attach SSE or WebSocket connection to stream rotation updates and live leaderboard pushes; rate-limiting; operational health checks (`/health/live`, `/health/ready`). |
