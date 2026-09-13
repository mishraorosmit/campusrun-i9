# Project I9 — Temporary Deployment & Supabase Integration Audit

**Date**: September 13, 2026  
**Target Frontend URL**: `https://campusrun.vercel.app`  
**Supabase Project**: `https://khovdbytibmnkjvxpawq.supabase.co`  
**Host Region**: `aws-0-ap-southeast-1`

---

## 1. Repository Architecture Analysis

1. **Frontend Framework & Build System**:
   - **Framework**: React 19.0.1, Vite 6.2.3, TailwindCSS 4 (@tailwindcss/vite).
   - **Build System**: Single-Page Application (SPA) compiled via `vite build` into `dist/`.
   - **Type Checking**: Verified with `npm run lint` (`tsc --noEmit`), passing with 0 errors.
   - **Bundle Output**: Production build completes in ~8.6s with no secrets or server-side environment variables embedded.
   - **SPA Routing**: Configured [vercel.json](file:///e:/PROJECTS/Campus-Run/campus-run-/vercel.json) with client-side rewrites to `/index.html`.

2. **Backend Framework & Runtime**:
   - **Framework**: Express 4.21.2 on Node.js v22 (executed with `tsx`).
   - **Runtime Requirements**: **Persistent Node.js server** (stateful daemon).
   - **Background Processes**: Active [RotationScheduler.ts](file:///e:/PROJECTS/Campus-Run/campus-run-/server/services/RotationScheduler.ts) running background interval timers (`setInterval`) for 45-minute spawn cycle rotations; PostgreSQL connection pool management (`pg` pool); database row locking (`SELECT FOR UPDATE`).
   - **Serverless Incompatibility**: The backend **cannot** be deployed as stateless Vercel Serverless Functions without breaking spawn rotation timers and connection pools. It requires a persistent container/server runtime (e.g., Render, Railway, Fly.io, AWS ECS/EC2).

3. **Package Structure**:
   - Frontend source: [src/](file:///e:/PROJECTS/Campus-Run/campus-run-/src)
   - Backend source: [server/](file:///e:/PROJECTS/Campus-Run/campus-run-/server)
   - Monorepo package: [package.json](file:///e:/PROJECTS/Campus-Run/campus-run-/package.json)

4. **Current Supabase Integration**:
   - The application connects to PostgreSQL using the standard Node `pg` driver and custom connection pooler in [pool.ts](file:///e:/PROJECTS/Campus-Run/campus-run-/server/infrastructure/database/pool.ts).
   - No direct `@supabase/supabase-js` client is currently installed or required; all database operations use standard PostgreSQL wire protocol.

5. **Current ORM & Migration System**:
   - Custom programmatic migration runner: [MigrationRunner.ts](file:///e:/PROJECTS/Campus-Run/campus-run-/server/infrastructure/database/migrations/MigrationRunner.ts).
   - 9 sequential SQL migrations in [server/infrastructure/database/migrations/sql/](file:///e:/PROJECTS/Campus-Run/campus-run-/server/infrastructure/database/migrations/sql/) tracking schema state in `schema_migrations`.
   - Applied cleanly to local PostgreSQL; ready to run against Supabase via `npm run db:migrate`.

6. **API Base URL Strategy**:
   - [src/services/apiGameService.ts](file:///e:/PROJECTS/Campus-Run/campus-run-/src/services/apiGameService.ts) supports `VITE_API_URL` and `NEXT_PUBLIC_API_URL`.
   - Falls back to relative `/api/v1` for local development behind the Vite proxy.
   - [vite.config.ts](file:///e:/PROJECTS/Campus-Run/campus-run-/vite.config.ts) configured with `envPrefix: ['VITE_', 'NEXT_PUBLIC_']`.

7. **Independent Deployment Feasibility**:
   - **Frontend**: Can be deployed independently to Vercel as a static SPA.
   - **Backend**: Must be hosted on a persistent Node.js platform with CORS configured for `https://campusrun.vercel.app`.

---

## 2. Configured Environment Variables (By Name Only)

### Browser-Safe (Vercel Frontend)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_API_URL` (or `VITE_API_URL`)

### Server-Only (Backend Host)
- `NODE_ENV` (`production`)
- `PORT`
- `CORS_ORIGIN` (`https://campusrun.vercel.app`)
- `DATABASE_URL` (Supabase pooler connection URI)
- `DIRECT_URL` (Supabase direct migration connection URI)
- `DB_POOL_MIN`
- `DB_POOL_MAX`
- `DB_CONNECT_TIMEOUT_MS`
- `DB_STATEMENT_TIMEOUT_MS`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_JWKS_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `AUTH_COLLEGE_DOMAIN`

> [!CAUTION]
> Neither `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `DIRECT_URL`, nor database passwords are included in frontend bundles, client source, or Git.

---

## 3. Database Connection & Supabase Status

- **Host Reachability**: `db.khovdbytibmnkjvxpawq.supabase.co:5432` was tested via TCP and is reachable (`TcpTestSucceeded : True`).
- **Connection Mode**:
  - Application runtime: `DATABASE_URL` via PgBouncer transaction pooler on port `6543`.
  - Migrations: `DIRECT_URL` on port `5432`.
- **Database Password Status**:
  - The placeholder `[YOUR-PASSWORD]` was provided in the instructions.
  - Per explicit instruction: *"If the actual database password is required and unavailable: do not modify it, do not fabricate one, report that deployment is blocked pending the real password."*
  - **Database connection and remote migration execution are BLOCKED pending the real database password.**

---

## 4. Authentication & OAuth Configuration

- **Domain Restriction**: Backend enforces `@campus.edu` college email domains.
- **Session Handling**: Authoritative server-side JWT verification with cryptographic signatures.
- **Required OAuth Callback URLs**:
  - Frontend: `https://campusrun.vercel.app/auth/callback`
  - Backend: `<BACKEND_URL>/api/v1/auth/google/callback`

---

## 5. Security & Leaked Credential Audit

A comprehensive repository audit was executed:
- `git status`: `.env` is properly ignored in `.gitignore`.
- `git grep`: No occurrences of `SUPABASE_SECRET_KEY`, `sb_secret_`, `DATABASE_URL`, `DIRECT_URL`, `service_role`, or plain-text passwords in tracked files.
- Compiled bundle audit: `dist/assets/index-*.js` scanned with 0 credential matches.

---

## 6. Current Deployment Status & Blockers

| Component | Status | Verification & Readiness |
|---|---|---|
| **FRONTEND** | **DEPLOYED (LIVE)** | `https://campusrun.vercel.app` is live on Vercel. Pushed to GitHub `main` branch (commit `79d5406`), triggering automatic Vercel production deployment with `vercel.json` SPA rewrites. |
| **GITHUB REPOSITORY** | **SYNCHRONIZED** | Pushed cleanly to `origin/main` (`https://github.com/mishraorosmit/campusrun-i9.git`). All files, seed scripts, types, and backend architecture synchronized. |
| **BACKEND** | **RUNNING (LOCAL) / PENDING CLOUD HOST** | Express backend daemon is running locally on port 3001 with active `RotationScheduler`, database pool, and authoritative claim engine. Ready to deploy to container hosting (Render/Railway/Fly.io) for production. |
| **DATABASE (LOCAL)** | **SYNCHRONIZED** | PostgreSQL `campus_run` fully migrated (15 tables) and seeded with 36 canonical spawn points across all 5 zones (`npm run db:seed`). |
| **DATABASE (SUPABASE)** | **READY TO MIGRATE** | Host `db.khovdbytibmnkjvxpawq.supabase.co:5432` is reachable. Migrations (`npm run db:migrate`) and seeding (`npm run db:seed`) are prepared to run against Supabase once `MIGRATION_DATABASE_URL` has the real database password. |
| **AUTH** | **WORKING** | JWT session issuance and verification works via `/api/v1/auth/dev-login`. Google OIDC backend client is implemented. |
| **MAP** | **WORKING** | Vector SVG canvas, building landmarks, and zone boundaries render cleanly and interactively. |
| **POINT COLLECTION**| **WORKING** | Authoritative claim engine with separation and anti-cheat is verified and functional. |
| **ADMIN** | **WORKING** | Admin screens, force rotation, settings updates, and weekly resets are implemented and tested. |

---

## 7. Next Actions for Supabase & Production Backend

1. **Apply Migrations to Supabase**:
   - In `.env`, set:
     ```env
     MIGRATION_DATABASE_URL="postgresql://postgres.khovdbytibmnkjvxpawq:[YOUR-REAL-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
     DATABASE_URL="postgresql://postgres.khovdbytibmnkjvxpawq:[YOUR-REAL-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
     ```
   - Run the migration runner:
     ```bash
     npm run db:migrate
     npm run db:seed
     ```
2. **Deploy Backend to Persistent Container Host**:
   - Host `server/` on Render, Railway, or Fly.io with:
     - `CORS_ORIGIN="https://campusrun.vercel.app"`
     - `DATABASE_URL` pointing to the Supabase pooler.
3. **Connect Frontend to Remote Backend**:
   - In the Vercel project settings for `campusrun.vercel.app`, set environment variable:
     - `NEXT_PUBLIC_API_URL="https://your-backend-service.com"` (or `VITE_API_URL`)

