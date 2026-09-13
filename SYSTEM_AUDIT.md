# Project I9 — Master System Reconciliation & Architecture Audit

**Audit Date**: September 13, 2026  
**Status**: Comprehensive Technical Audit Completed  
**Objective**: Reconcile the entire codebase (Frontend, Backend API, Database, PostGIS, Geospatial, Spawn Engine, Rotation Engine, Claim Engine, Admin, Analytics, Security) and determine whether they form one unified, working production system.

---

## 1. Executive Summary & Verdict

Project I9 has a **robust, production-grade core backend** for Spawn Management, Batch Generation, Rotation Scheduling, Geospatial Boundaries, and Authoritative Claim Transactions. These backend modules have undergone rigorous testing (concurrency storms, row locking, PostGIS/polygon fallbacks, zero-trust anti-cheat, atomic rollbacks).

**HOWEVER, THE SYSTEM CURRENTLY CONSISTS OF TWO DISCONNECTED WORLDS:**
1. **The Backend & PostgreSQL Core** (Phases 01–20): High-assurance, transactional, zero-trust backend running on Express (`http://localhost:3001/api/v1`) and PostgreSQL with authoritative state.
2. **The Frontend Application** (`src/`): A rich, responsive React 19 + Vite UI (`http://localhost:3000`) that **never makes HTTP network requests to the backend**. Instead, it imports and calls [`src/services/mockGameService.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/services/mockGameService.ts), managing simulated state in-memory.

Furthermore, within the backend itself, several integration gaps exist:
- PostGIS binary extension is **not installed** in the local PostgreSQL server; the backend is operating on its fallback PostgreSQL native geometric polygon containment mode.
- Leaderboard and Zone endpoints rely on **in-memory repositories** initialized to empty arrays (`[]`), completely disconnected from PostgreSQL `profiles` and campus boundaries.
- The `RotationScheduler` is instantiated in [`server/app.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/app.ts) but **is never started** in [`server/index.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/index.ts).
- Admin configuration endpoints for Game Settings and Weekly Cycles are **mock stub handlers** returning static JSON strings.

---

## 2. Layer-by-Layer Audit Assessment

| # | Layer | Audit Classification | Core Finding |
|---|---|---|---|
| **1** | **FRONTEND** | **DISCONNECTED / MOCK** | UI is built and visually functional, but calls `mockGameService` directly. Zero HTTP `fetch` calls to backend. |
| **2** | **BACKEND API** | **PARTIALLY IMPLEMENTED** | Core endpoints (spawns, claims, admin mutations, auth) work; leaderboard, zones, settings stubs are disconnected. |
| **3** | **DATABASE** | **IMPLEMENTED** | 8 SQL migrations applied. Core tables (`users`, `profiles`, `spawn_batches`, `spawn_points`, `claims`, `audit_logs`, `campus_boundaries`) present. `zones` table missing. |
| **4** | **POSTGRESQL + POSTGIS** | **INCONSISTENT** | PostGIS extension is **not installed** in the DB cluster (`AVAILABLE POSTGIS EXTENSIONS: []`). System runs on native PostgreSQL geometric types (`point`, `polygon`) fallback. |
| **5** | **AUTHENTICATION / AUTHORIZATION** | **DISCONNECTED** | Backend: Cryptographic JWT verification, `requireAuthenticatedUser`, and `requireAdmin` are strictly enforced. Frontend: No login screen, no token management, role toggle is a client-side React state. |
| **6** | **GEOSPATIAL SYSTEM** | **IMPLEMENTED (FALLBACK MODE)** | Boundary containment, affine projection, and distance calculations work authoritatively via PostgreSQL native polygon queries + Haversine formulas. |
| **7** | **SPAWN MANAGEMENT** | **IMPLEMENTED (BACKEND)** | Domain entity, PostgreSQL repository, and admin CRUD endpoints with separation rules and audit logging work cleanly. Frontend displays mock spawns. |
| **8** | **SPAWN BATCH / ROTATION** | **PARTIALLY IMPLEMENTED** | Batch lifecycle, generation, atomic handoff, concurrency locks, and force rotation work in DB. BUT background `RotationScheduler.start()` is never called in `server/index.ts`. |
| **9** | **CLAIM ENGINE** | **IMPLEMENTED (BACKEND)** | Server-side distance check, row lock `SELECT FOR UPDATE`, atomic point updates, replay defense, and `CLAIM_SUCCESS` events work. Frontend never calls it. |
| **10**| **ADMIN APIs** | **PARTIALLY IMPLEMENTED** | Spawn mutations and force rotation work with audit trails. Game settings, rotation config, and weekly reset endpoints are stub handlers returning placeholder messages. |
| **11**| **ANALYTICS** | **MISSING** | `analytics_events` table exists, but no service, repository, or API queries it. Frontend displays static hardcoded statistics. |
| **12**| **VALIDATION** | **IMPLEMENTED** | Request schemas enforce coordinate bounds, point values, code lengths, and role permissions server-side. |
| **13**| **SECURITY / ANTI-CHEAT** | **IMPLEMENTED (BACKEND)** | Zero-trust backend ignores client points, rank, distance, and player ID. Concurrency race conditions handled cleanly. |

---

## 3. Dependency Map: Tracing Execution Paths

```
[FRONTEND: React 19 UI]
  |
  +-- (Current Reality) ------------> [MockGameService (In-Memory)]
  |                                        |-- INITIAL_SPAWNS (hardcoded campusMap.ts)
  |                                        |-- CURRENT_PLAYER (hardcoded mockPlayer.ts)
  |                                        |-- SAMPLE_LEADERBOARD (in-memory sort)
  |
  +-- (Intended Production Path) ----> [HTTP Client / ApiService] (MISSING)
                                           |
                                           v
[HTTP API ROUTER: /api/v1] ----------------+
  |
  +-- /auth ------------------------> [AuthService] ------> [GoogleOidcClient + PostgresPlayerRepository]
  |                                                           |--> PostgreSQL: users, profiles, admins
  |
  +-- /spawns ----------------------> [SpawnController]
  |                                     |--> [GetActiveSpawnsUseCase] -> [PostgresSpawnRepository]
  |                                            |--> PostgreSQL: spawn_points (WHERE status = 'active')
  |
  +-- /claims ----------------------> [ClaimController]
  |                                     |--> [ClaimSpawnUseCase] (Atomic Transaction)
  |                                            |--> PostgreSQL: spawn_points (SELECT ... FOR UPDATE)
  |                                            |--> PostgreSQL: spawn_batches (expires_at check)
  |                                            |--> Geospatial (PostgresGeospatialService: distance check)
  |                                            |--> PostgreSQL: claims (INSERT)
  |                                            |--> PostgreSQL: profiles (UPDATE season_points, total_points)
  |                                            |--> EventBus (CLAIM_SUCCESS event)
  |
  +-- /leaderboard -----------------> [LeaderboardController]
  |                                     |--> [GetLeaderboardUseCase]
  |                                            |--> [InMemoryLeaderboardRepository] (DISCONNECTED LINK: Returns [])
  |                                            |--X (Should query PostgreSQL profiles table!)
  |
  +-- /zones -----------------------> [ZoneController]
  |                                     |--> [GetZonesUseCase]
  |                                            |--> [InMemoryZoneRepository] (DISCONNECTED LINK: Returns [])
  |                                            |--X (No zones table in PostgreSQL!)
  |
  +-- /admin -----------------------> [AdminController]
                                        |--> /spawns (AdminManageSpawnsUseCase -> PostgresSpawnRepository + audit_logs)
                                        |--> /rotate (RotationService -> PostgresBatchRepository + cycle row lock)
                                        |--> /settings (STUB: Returns dummy string, ignores game_settings table)
                                        |--> /cycles/reset (STUB: Returns dummy string, no cycle reset logic)

[BACKGROUND SCHEDULER]
  |
  +-- RotationScheduler ------------> [RotationService]
        |--X (DISCONNECTED LINK: server/index.ts never invokes rotationScheduler.start()!)
```

---

## 4. Critical Answers to System Questions

### 1. Does the frontend call the actual backend APIs?
**NO.** Grep search across `src/` for `fetch(`, `axios`, or API base URLs yielded 0 results. [`src/App.tsx`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/App.tsx#L23) and [`src/pages/admin/AdminDashboardPage.tsx`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/pages/admin/AdminDashboardPage.tsx#L12) import `gameService` directly from `src/services/mockGameService.ts`.

### 2. Are mock repositories/data still being used anywhere they should not be?
**YES.**
- **Backend**: In [`server/app.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/app.ts#L141-L143), `zoneRepo`, `rotationRepo`, and `leaderboardRepo` are hardcoded to `InMemoryZoneRepository`, `InMemoryRotationRepository`, and `InMemoryLeaderboardRepository` even in production mode (`NODE_ENV=production` or `development`).
- **Frontend**: The entire game lifecycle runs on `MockGameService`, `campusMap.ts`, and `mockPlayer.ts`.

### 3. Do frontend types match backend response types?
**NO, SEVERE MISMATCHES EXIST:**
- **Spawn Points**:
  - Frontend [`src/types/index.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/types/index.ts#L10-L35) expects flat coordinates `{ lat, lng, svgX, svgY }`, plus `zoneId`, `zoneName`, and `expiresAt`.
  - Backend [`SpawnPoint.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/domain/entities/SpawnPoint.ts#L182-L200) returns `{ coordinates: { lat, lng }, svgCoordinates: { x, y }, batchId }`. It has **no `zoneId`**, **no `zoneName`**, and expiration is stored at the batch level (`SpawnBatch.expiresAt`).
- **Claim Submission & Result**:
  - Frontend expects: `{ success: boolean, claim: ClaimRecord, updatedPlayer: PlayerProfile, updatedWeeklyLeaderboard: LeaderboardEntry[], notifications: AppNotification[] }`.
  - Backend `POST /api/v1/claims` returns RFC 7807/JSend: `{ success: true, data: { claimId, spawnId, spawnName, pointsAwarded, weeklyPoints, allTimePoints, claimedAt, distanceMeters, weeklyRank } }`.
- **Player Profile**:
  - Frontend expects `role: 'player' | 'admin' | 'superadmin'` (lowercase).
  - Backend returns `role: 'STUDENT' | 'ADMIN'` (uppercase).

### 4. Do backend models match the actual database schema?
**PARTIALLY:**
- `spawn_points`, `spawn_batches`, `claims`, `users`, `profiles`, `audit_logs`, `campus_boundaries`, and `game_settings` match the database schema.
- **Missing Table**: There is **no `zones` table** in PostgreSQL. `CampusZone` exists as an in-memory domain entity, but has no migration, table, or PostgreSQL repository.

### 5. Do migrations actually create the required tables?
**YES**, for 14 tables: `users`, `profiles`, `admins`, `weekly_cycles`, `spawn_batches`, `spawn_points`, `claims`, `notifications`, `push_subscriptions`, `game_settings`, `audit_logs`, `analytics_events`, `campus_boundaries`, `schema_migrations`. But no migration was ever written for campus zones.

### 6. Does PostGIS actually exist and work?
**NO.** Running `SELECT * FROM pg_available_extensions WHERE name LIKE '%postgis%';` returned `[]`.
- PostGIS binaries are **not installed** in the host PostgreSQL instance.
- The backend's fallback layer in [`PostgisGeoQueries.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/infrastructure/geo/PostgisGeoQueries.ts#L77-L100) dynamically checks `hasPostgis()`. Finding none, it executes native PostgreSQL polygon containment (`boundary @> point($1, $2)`) and in-memory geodesic Haversine distance calculation.

### 7. Are all required indexes/constraints present?
**YES.** PostgreSQL constraints exist and are verified:
- Unique partial index: `idx_spawn_batches_unique_active` (single active batch per cycle).
- Unique composite constraint: `uq_claims_player_spawn_batch` (exactly-once claiming).
- Check constraints: coordinates ranges, positive point values, claim radius (`5m - 150m`), batch duration (`expires_at > started_at`).

### 8. Are authentication and admin authorization enforced server-side?
**YES, IN BACKEND.**
- `requireAuthenticatedUser` rejects unauthenticated requests with `401 Unauthorized`.
- `requireAdmin` checks the `admins` table and rejects unauthorized students with `403 Forbidden`.
- **FRONTEND GAP**: Frontend has no login view, no JWT handling, and switches between player and admin mode purely via React state.

### 9. Are game settings persisted and actually consumed?
- **Consumed**: YES. Default rows exist in the `game_settings` table (rotation interval: 45 min, active spawns: 15, min distance: 60m, claim radius: 25m). [`GameSettingsService.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/services/GameSettingsService.ts) loads them for batch generation and rotation.
- **Persisted Mutations**: NO. [`AdminController.updateGameSettings`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/controllers/AdminController.ts#L205) is an empty stub returning `{ success: true, message: 'Game settings mutation authorized.' }` without modifying PostgreSQL.

### 10. Does spawn management modify the same data used by rotation?
**YES.** `AdminCreateSpawnUseCase`, `AdminEditSpawnUseCase`, and `AdminManageSpawnsUseCase` write directly to PostgreSQL `spawn_points`. `GenerateBatchUseCase` selects candidates from this exact table, and `ActivateBatchUseCase` updates them.

### 11. Does rotation operate on the same spawn data displayed by the frontend?
**NO.** Rotation updates PostgreSQL `spawn_batches` and `spawn_points`. The frontend displays static hardcoded points from `src/data/campusMap.ts`.

### 12. Does the claim engine use the actual active spawn state?
**YES (IN BACKEND).** `ClaimSpawnUseCase` locks the active row in `spawn_points`, verifies `batch_id = activeBatch.id`, and validates against `spawn_batches.expires_at`.

### 13. Are weekly and all-time scores using the same authoritative player data?
**IN BACKEND TRANSACTION**: YES. `profiles.season_points` (weekly) and `profiles.total_points` (all-time) are updated in the same atomic SQL transaction.
**IN BACKEND LEADERBOARD API**: NO. [`GetLeaderboardUseCase`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/services/GetLeaderboardUseCase.ts) calls `InMemoryLeaderboardRepository`, returning `[]`, instead of querying `profiles`!

### 14. Are analytics derived from real persisted events?
**NO.** `analytics_events` table only has rotation events written by `RotationService`. There is no analytics service or controller. The frontend displays hardcoded mock statistics in [`AdminStatsTab.tsx`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/pages/admin/AdminStatsTab.tsx).

### 15. Are frontend maps/spawns/claims using real backend state?
**NO.** Frontend is 100% disconnected from the backend API.

---

## 5. Highest-Priority Defects (Ranked by Severity)

### Defect P0-1: Complete Frontend-to-Backend Network Disconnect
- **Impact**: The application cannot be played as a client-server game. The frontend runs in a sandbox with mock data.
- **Affected Files**: [`src/App.tsx`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/App.tsx), [`src/services/mockGameService.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/services/mockGameService.ts).
- **Requirement**: Implement an HTTP `ApiClient` and `ApiGameService` implementing `IGameService` that calls `/api/v1/*`. Add a Vite proxy to route `/api` requests from port 3000 to port 3001.

### Defect P0-2: Data Contract & Type Incompatibility Between Frontend & Backend
- **Impact**: Even if the frontend fetches `/api/v1/spawns/active`, the map will break because:
  1. Frontend expects `spawn.lat` and `spawn.lng`; backend returns `spawn.coordinates.lat` and `spawn.coordinates.lng`.
  2. Frontend expects `spawn.svgX` and `spawn.svgY`; backend returns `spawn.svgCoordinates.x` and `spawn.svgCoordinates.y`.
  3. Frontend expects `spawn.expiresAt` on the spawn point; backend stores expiration on `SpawnBatch`.
  4. Frontend expects `spawn.zoneName` and `spawn.zoneId`; backend `spawn_points` table does not have zones.
- **Affected Files**: [`src/types/index.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/types/index.ts), [`server/domain/entities/SpawnPoint.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/domain/entities/SpawnPoint.ts).

### Defect P0-3: Leaderboard API Uses In-Memory Stub (Returns Empty Array)
- **Impact**: `GET /api/v1/leaderboard/weekly` and `GET /api/v1/leaderboard/all-time` return empty arrays (`[]`), completely ignoring all points earned in `profiles`.
- **Affected Files**: [`server/app.ts:143`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/app.ts#L143), [`server/infrastructure/repositories/inmemory/InMemoryLeaderboardRepository.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/infrastructure/repositories/inmemory/InMemoryLeaderboardRepository.ts).
- **Requirement**: Create `PostgresLeaderboardRepository` that queries `profiles` ordered by `season_points DESC` (weekly) and `total_points DESC` (all-time) with rank computation.

### Defect P1-1: Background Rotation Scheduler Never Started on Server Boot
- **Impact**: In a running production server (`npm run server`), spawn batches will never rotate automatically because `rotationScheduler.start()` is never called in `server/index.ts`.
- **Affected Files**: [`server/index.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/index.ts), [`server/app.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/app.ts).

### Defect P1-2: Missing `zones` Table & Database Persistence
- **Impact**: `GET /api/v1/zones` returns `[]`. Frontend campus map zones cannot be loaded dynamically from the backend.
- **Affected Files**: [`server/infrastructure/repositories/inmemory/InMemoryZoneRepository.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/infrastructure/repositories/inmemory/InMemoryZoneRepository.ts), [`server/routes/v1/zones.routes.ts`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/routes/v1/zones.routes.ts).
- **Requirement**: Add migration for `campus_zones` seeded with canonical Stanford zones, and implement `PostgresZoneRepository`.

### Defect P1-3: Admin Configuration & Weekly Reset Handlers are Empty Stubs
- **Impact**: Admins cannot update rotation intervals, game settings, or trigger weekly resets from the dashboard.
- **Affected Files**: [`server/controllers/AdminController.ts:150-214`](file:///e:/PROJECTS/Campus-Run/campus-run-/server/controllers/AdminController.ts#L150-L214).

### Defect P1-4: Frontend Lacks Authentication & Token Flow
- **Impact**: Requests to protected backend endpoints (`/api/v1/claims`, `/api/v1/player/me`, `/api/v1/admin/*`) will fail with `401 Unauthorized` because the frontend has no auth token handling.
- **Affected Files**: [`src/App.tsx`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/App.tsx), [`src/layouts/PlayerLayout.tsx`](file:///e:/PROJECTS/Campus-Run/campus-run-/src/layouts/PlayerLayout.tsx).

---

## 6. Exact Repair Order (Next Phase)

```mermaid
graph TD
    Step1["Step 1: Unify Data Contracts & DTO Adapters (Spawn, Claim, Profile)"] --> Step2["Step 2: Implement PostgresLeaderboardRepository & PostgresZoneRepository"]
    Step2 --> Step3["Step 3: Connect Frontend HTTP API Service (Replace MockGameService)"]
    Step3 --> Step4["Step 4: Implement Frontend Auth & Token Management (Student & Admin)"]
    Step4 --> Step5["Step 5: Wire RotationScheduler.start() into server/index.ts"]
    Step5 --> Step6["Step 6: Implement Real Admin Game Settings & Weekly Reset Mutations"]
    Step6 --> Step7["Step 7: Connect Analytics & Notifications to Persisted Events"]
    Step7 --> Step8["Step 8: End-to-End System Integration Test (Browser + Backend + DB)"]
```

### Stage 1: Data Contracts & DTO Alignment
1. **DTO Mapping**: In `server/controllers/SpawnController.ts`, ensure `getActiveSpawns` returns flattened properties (`lat`, `lng`, `svgX`, `svgY`, `expiresAt`) alongside domain properties so both frontend and backend contracts are satisfied.
2. **Claim Response Format**: Align `ClaimController` response payload with `ClaimResult` expected by the frontend gameplay UI.

### Stage 2: Database & Repository Completeness
1. **Postgres Leaderboard Repository**: Implement `PostgresLeaderboardRepository` querying `profiles` table with window ranking (`RANK() OVER (ORDER BY season_points DESC)`). Wire it into `server/app.ts`.
2. **Campus Zones Migration & Repository**: Create migration `20260913000009_create_campus_zones.sql` populated with campus zones (`NORTH-QUAD`, `ENGINEERING-PLAZA`, `MEMORIAL-COURT`, `ATHLETICS-DISTRICT`), implement `PostgresZoneRepository`, and wire it into `server/app.ts`.

### Stage 3: Frontend Integration
1. **API Service Implementation**: Create `src/services/apiGameService.ts` implementing `IGameService`. It will make standard `fetch` requests with JSON headers and Authorization Bearer tokens.
2. **Vite Proxy**: Add proxy in `vite.config.ts` mapping `/api` to `http://localhost:3001`.
3. **Environment Configuration**: Set `VITE_API_URL` to `/api/v1`.

### Stage 4: Authentication Bridge
1. Add an authentication provider / session hook in the frontend (`useAuth`).
2. Provide a dev login toggle (Student / Admin) that obtains a real signed JWT from the backend (`/api/v1/auth/session` or dev token endpoint) and attaches it to outgoing requests.

### Stage 5: Backend Boot & Lifecycle Finalization
1. Update `server/index.ts` to call `rotationScheduler.start()` after `createApp()`.
2. Ensure graceful shutdown stops `rotationScheduler`.

### Stage 6: Admin Mutations & Analytics Wiring
1. Implement real SQL queries in `AdminController` for `updateGameSettings` (updating `game_settings` table).
2. Implement weekly cycle transition logic in `AdminController.manualWeeklyReset` (completing current `weekly_cycles`, creating next cycle, resetting `profiles.season_points`).
3. Wire `analytics_events` into an `AdminAnalyticsUseCase` to supply real stats to `AdminStatsTab`.

---

## 7. Conclusion

Project I9's foundational business logic, database transactions, anti-cheat mechanisms, and geospatial algorithms are robust and sound. The required work in the upcoming phase is **pure integration**: removing in-memory stubs, bridging the frontend to the backend HTTP API, aligning type definitions, and booting background schedulers.

---

## 8. Post-Repair Reconciliation Status

**Execution Date**: September 13, 2026  
**Verification Suite**: 
- `run-full-spawn-to-rotation-audit.ts` (10 / 10 Phases Passed, 100%)
- `test-system-sync.ts` (8 / 8 Synchronization Audits Passed, 100%)
- `npx tsc --noEmit` (0 TypeScript Compiler Errors)

---

### FIXED

1. **Database Persistence & Schemas**:
   - **Migration `20260913000009_create_campus_zones.sql`**: Added canonical `campus_zones` table with code, name, SVG vector polygon paths, bounding centers (`center_lat`, `center_lng`), bounds JSON, and color schemes. Seeded with 5 official campus zones. Applied cleanly via `MigrationRunner`.
   - **Constraints & Audit Table**: Verified constraints, foreign keys, and indexes across all 15 tables (`users`, `profiles`, `admins`, `weekly_cycles`, `spawn_batches`, `spawn_points`, `claims`, `notifications`, `push_subscriptions`, `game_settings`, `audit_logs`, `analytics_events`, `campus_boundaries`, `campus_zones`, `schema_migrations`).

2. **Backend Repositories & Real Data Flow**:
   - **PostgresZoneRepository**: Built and wired into `server/app.ts`, eliminating `InMemoryZoneRepository`. `GET /api/v1/zones` now queries PostgreSQL.
   - **PostgresLeaderboardRepository**: Built and wired into `server/app.ts`, eliminating `InMemoryLeaderboardRepository`. Leaderboards now query the `profiles` table with authoritative window ranking (`RANK() OVER (ORDER BY season_points DESC)`).
   - **Claim-to-Leaderboard Sync**: Claims immediately update `profiles.season_points` and `profiles.total_points`, which are instantly reflected in `GET /api/v1/leaderboard/weekly` and `GET /api/v1/leaderboard/all-time`.

3. **Background Scheduler Lifecycle**:
   - **Boot Lifecycle**: Updated `server/index.ts` to boot `rotationScheduler.start()` when the server launches, guaranteeing background spawn rotations run without frontend dependencies.
   - **Graceful Shutdown**: Wired `rotationScheduler.stop()` into `SIGTERM` and `SIGINT` handlers.

4. **API Contracts & DTO Alignment**:
   - **Spawn DTOs**: Added flat convenience coordinates (`lat`, `lng`, `svgX`, `svgY`, `expiresAt`) alongside domain nested coordinates in `SpawnPoint.toJSON()` and `SpawnSummaryDTO`, satisfying both backend and frontend consumers.
   - **Zone DTOs**: Added flat `centerLat` and `centerLng` in `CampusZoneDTO` and `GetZonesUseCase`.
   - **Claim Submission & Response**: Authoritative claim response provides typed payload with server-derived distances, points awarded, new weekly points, and leaderboard rank.

5. **Admin Configuration & Weekly Cycle Mutations**:
   - **Rotation Config**: Replaced stub in `AdminController.updateRotationConfig` with real PostgreSQL updates to `game_settings` (`engine.rotation_interval_minutes`, `engine.concurrent_active_spawns`, `engine.min_spawn_distance_meters`) and immutable audit logging.
   - **Game Settings**: Replaced stub in `AdminController.updateGameSettings` with multi-key batch updates and audit trail persistence.
   - **Manual Weekly Reset**: Implemented atomic transaction in `AdminController.manualWeeklyReset`: completes active cycle, inserts new cycle, wipes `profiles.season_points` to 0 while preserving `total_points`, emits audit log, and triggers a fresh spawn batch rotation.

6. **Frontend-to-Backend Network Bridge**:
   - **ApiGameService (`src/services/apiGameService.ts`)**: Implemented complete HTTP service implementing `IGameService`, communicating directly with `/api/v1/*` (`/zones`, `/spawns/active`, `/claims`, `/leaderboard/weekly`, `/leaderboard/all-time`, `/player/me`, `/admin/rotation/config`, `/admin/settings`, `/admin/cycles/reset`).
   - **Vite Reverse Proxy**: Configured Vite proxy in `vite.config.ts` mapping `/api` to `http://127.0.0.1:3001`.
   - **Auth Bridge**: Implemented `/api/v1/auth/dev-login` allowing instant seamless switching between Student and Admin sessions with cryptographically signed JWTs stored in `localStorage`.
   - **UI Integration**: `src/App.tsx` and `src/pages/admin/AdminDashboardPage.tsx` now import and utilize `apiGameService`, falling back gracefully to mock data only if the backend server is unreachable.

7. **Validation, Security & Anti-Cheat**:
   - **Zero-Trust**: Backend ignores client-provided distance, points, rank, and user ID.
   - **Row-Lock Concurrency**: High-concurrency claim races tested and verified (10 concurrent requests -> exactly 1 winner, 9 rejected with `ALREADY_CLAIMED`).
   - **Event Integrity**: `CLAIM_SUCCESS` emitted strictly after database transaction commits.

---

### REMAINING

1. **Push Notifications & WebPush Delivery**:
   - `notifications` and `push_subscriptions` tables and domain models exist in PostgreSQL. Real push notifications using VAPID keys (`web-push`) remain for a future notification phase (currently logged via EventBus).
2. **Google OIDC Frontend OAuth Popup**:
   - Backend `GoogleOidcClient` is fully implemented and operational with Google Public Keys. The frontend currently uses the session `/api/v1/auth/dev-login` bridge for pairing with the backend in development/staging. Production OAuth popup UI component remains to be wired when production Google Client ID is configured.

---

### BLOCKED

- **Host PostGIS Binary Extension**:
  - The local PostgreSQL installation on the host machine lacks the native compiled PostGIS C-extension binaries (`AVAILABLE POSTGIS EXTENSIONS: []`).
  - **Resolution / Status**: NOT a blocker for system operation. The backend's dynamic fallback engine (`PostgisGeoQueries.ts`) automatically detects the absence of PostGIS and seamlessly executes native PostgreSQL geometric polygon containment (`boundary @> point($1, $2)`) and in-memory geodesic Haversine distance calculations. When deployed to a production PostgreSQL instance with PostGIS enabled (e.g. AWS RDS / Supabase / Neon), the engine automatically detects it and promotes to native `ST_DWithin` and `ST_Contains`.

