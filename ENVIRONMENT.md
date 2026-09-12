# Project I9 — Environment & Configuration Specification

This document details all configuration parameters, environment variables, validation rules, and startup behaviors for the Project I9 backend.

---

## 1. Startup Validation Guarantee

All configuration is parsed and validated synchronously on server startup via `server/config/env.ts`.

- **Fail-Fast Enforcement:** If any required environment variable is missing, malformed, or outside valid numeric ranges, the process aborts immediately with diagnostic error messages and exit code 1.
- **Zero Hardcoded Secrets:** No secrets or private keys are hardcoded in application source files.
- **Single Source of Truth:** Code accesses configuration exclusively through the typed `config` singleton exported from `server/config/index.ts`.

---

## 2. Configuration Variables Catalog

| Variable | Type | Default Value | Allowed Values / Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | `string` | `development` | `development`, `production`, `test` | Node runtime environment mode. |
| `PORT` | `number` | `3001` | Integer `1` – `65535` | HTTP network listening port for Express. |
| `API_PREFIX` | `string` | `/api/v1` | Must start with `/` | API version base path. |
| `APP_URL` | `string` | `http://localhost:3000` | Valid URL | Public URL of the frontend / applet. |
| `CORS_ORIGIN` | `string` | `*` | Allowed origin or `*` | Access-Control-Allow-Origin header value. |
| `ROTATION_INTERVAL_MINUTES` | `number` | `45` | Integer `> 0` | Duration of each spawn rotation window in minutes. |
| `MIN_SPAWN_DISTANCE_METERS` | `number` | `60` | Integer `> 0` | Minimum physical distance between any two active spawn points. |
| `CLAIM_RADIUS_METERS` | `number` | `25` | Integer `> 0` | Maximum radius in meters for a player to claim a point. |
| `CONCURRENT_ACTIVE_SPAWNS` | `number` | `15` | Integer `> 0` | Number of concurrent active spawn points on the campus map. |
| `STREAK_GRACE_HOURS` | `number` | `24` | Integer `> 0` | Grace period in hours before daily claim streak resets. |
| `DATABASE_URL` | `string` | *(Optional in Phase 02)* | PostgreSQL connection string | Connection URI for PostgreSQL + PostGIS (Phase 04). |

---

## 3. Usage Example

```typescript
import { config } from './config';

console.log(`Server starting on port ${config.PORT}`);
console.log(`Claim radius enforced at ${config.CLAIM_RADIUS_METERS} meters`);
```
