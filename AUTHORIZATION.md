# Campus Run (Project I9) — Authorization Architecture & Role Model

**Status**: Authoritative Reference  
**Scope**: Project I9 Backend API & Security Layer  
**Phase**: Authorization Phase 01  

---

## 1. Executive Summary & Security Philosophy

The Project I9 authorization model defines how access rights and permissions are resolved, enforced, and audited across all backend resources.

### Core Security Principles

1. **Zero-Trust Client & Request Payloads**  
   Roles and permissions are **never** accepted from incoming request payloads (headers, bodies, or query parameters) and are **never** trusted from frontend client state (e.g., `localStorage`, cookies, or client-rendered state).
2. **Server-Controlled Authorization**  
   All role determinations are computed authoritatively on the server by inspecting verified database state at session establishment and verified cryptographically on subsequent requests.
3. **Strict Two-Role Application Model**  
   The application layer recognizes **strictly two roles**:
   - `STUDENT` (Standard Player)
   - `ADMIN` (Game / System Administrator)
   No intermediate, speculative, or custom roles (e.g., `moderator`, `superadmin`, `guest`) exist at the application level.
4. **Default-Least-Privilege**  
   Every authenticated user defaults to the `STUDENT` role upon first login. Administrative privileges cannot be assumed, inherited, or requested during authentication.
5. **Fail-Closed by Design**  
   Any request with missing, malformed, expired, revoked, or insufficient credentials is immediately rejected with standard RFC 7807 error responses prior to executing domain logic.

---

## 2. Application Roles Specification

The application domain defines exactly two operational roles:

```typescript
// server/domain/types.ts
export type PlayerRole = 'STUDENT' | 'ADMIN';
```

### Role Descriptions

| Role | Target Audience | Primary Responsibilities |
| :--- | :--- | :--- |
| `STUDENT` | Official college students | Active gameplay participants. Can view campus zones, discover active spawn points, submit claims with geospatial verification, view personal claim histories, inspect player profiles, view campus leaderboard standings, and manage their own sessions. |
| `ADMIN` | Designated campus operations / faculty | Game master & administrative overseers. Possesses full `STUDENT` gameplay capabilities plus privileged access to manage spawn points (create, update, toggle, quarantine), trigger manual spawn rotation cycles, modify game configuration settings, inspect system audit logs, and query gameplay analytics. |

---

## 3. Server-Controlled Administrative Authorization

Administrative authorization is governed strictly by the dedicated, independent `admins` table in PostgreSQL.

### Database Schema Reference

```sql
-- server/infrastructure/database/migrations/sql/20260913000002_create_users_profiles_admins.sql
CREATE TABLE IF NOT EXISTS admins (
  user_id UUID PRIMARY KEY,
  role VARCHAR(20) NOT NULL DEFAULT 'admin',
  granted_by UUID,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,

  CONSTRAINT fk_admins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_admins_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_admins_role CHECK (role IN ('moderator', 'admin', 'superadmin'))
);
```

### Role Resolution Mechanics

1. **Separation of Concerns**:  
   Neither `users` nor `profiles` tables contain a `role` column. The user record stores only core identity and account status; the profile record stores public gameplay statistics. This architectural separation guarantees that profile mutations (e.g. updating display name or avatar) can **never** inadvertently elevate or alter user roles.

2. **Authoritative SQL Query**:  
   When resolving user identity during authentication or session retrieval, the application executes:
   ```sql
   SELECT 
     u.id, 
     u.email, 
     u.status, 
     p.username, 
     p.display_name, 
     a.role as admin_role
   FROM users u
   JOIN profiles p ON u.id = p.user_id
   LEFT JOIN admins a ON u.id = a.user_id AND a.revoked_at IS NULL
   WHERE u.id = $1;
   ```

3. **Deterministic Mapping**:  
   In `PostgresPlayerRepository`:
   ```typescript
   // Exactly two application roles: STUDENT and ADMIN.
   // If an active (non-revoked) record exists in the admins table, the user is ADMIN; otherwise STUDENT.
   const role: PlayerRole = row.admin_role ? 'ADMIN' : 'STUDENT';
   ```

4. **Instant Revocation**:  
   An administrator's privileges are instantly terminated when `admins.revoked_at` is set to a timestamp (`revoked_at IS NOT NULL`). Upon the next token refresh or session issuance, the resolved role immediately drops back to `STUDENT`.

---

## 4. Zero-Trust Role Protection

To prevent privilege escalation and role injection attacks, the following constraints are strictly enforced:

### A. Role Ignored in Request Payloads
No API endpoint accepts a `role` parameter in request bodies or query parameters. Request validation schemas explicitly omit and reject `role` fields:
- `ClaimSubmissionSchema` validates only `spawnId`, `lat`, `lng`.
- `AdminToggleSpawnSchema` validates only `enabled`.
- Any unexpected client-supplied `role` field in incoming JSON is discarded and never passed to domain entities.

### B. Cryptographically Signed Session Token
When a session is established:
1. Google identity is validated server-side.
2. College email domain is verified.
3. Database evaluates user and `admins` table membership.
4. The server signs the resolved role into the short-lived (15-minute) JWT:
   ```typescript
   const payload: JwtPayload = {
     sub: player.id,
     email: player.props.email,
     username: player.username,
     role: player.role, // 'STUDENT' | 'ADMIN'
   };
   ```
5. On incoming requests, `createAuthMiddleware` cryptographically verifies the token signature using constant-time comparison (`crypto.timingSafeEqual`) and attaches the trusted identity to `req.user`.

---

## 5. Authoritative Authorization Matrix

Every route in the Project I9 backend belongs to one of three authorization tiers:
1. **PUBLIC**: Accessible without credentials.
2. **AUTHENTICATED (`STUDENT` or `ADMIN`)**: Requires a valid session from an active institutional account.
3. **ADMINISTRATIVE (`ADMIN` ONLY)**: Restricted exclusively to users with active records in the `admins` table.

| Endpoint / Operation | HTTP Method | Required Role | Unauthenticated Response | Unauthorized Response (Wrong Role) | Rationale / Description |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **System & Health** | | | | | |
| `/api/health` | `GET` | `PUBLIC` | `200 OK` | N/A | Liveness & readiness probes for reverse proxies and monitoring. |
| **Authentication Flow** | | | | | |
| `/api/v1/auth/google` | `GET` | `PUBLIC` | `302 Redirect` | N/A | Initiates Google OAuth authorization code flow. |
| `/api/v1/auth/google/url` | `GET` | `PUBLIC` | `200 OK` | N/A | Returns authorization URL and state for SPA client navigation. |
| `/api/v1/auth/google/callback` | `GET` | `PUBLIC` | `200 OK` / `401` | N/A | Receives Google redirect, exchanges PKCE code, sets session cookie. |
| `/api/v1/auth/google/verify-token` | `POST` | `PUBLIC` | `200 OK` / `401` | N/A | Direct verification of Google One Tap / GIS ID token. |
| `/api/v1/auth/refresh` | `POST` | `PUBLIC` (Cookie req.) | `401 Unauthorized` | N/A | Rotates refresh token cookie and issues fresh access JWT. |
| `/api/v1/auth/logout` | `POST` | `STUDENT` or `ADMIN` | `200 OK` | N/A | Revokes refresh token in registry and clears auth cookies. |
| `/api/v1/auth/session` | `GET` | `STUDENT` or `ADMIN` | `401 Unauthorized` | N/A | Returns verified minimal session identity (`sub`, `email`, `role`). |
| `/api/v1/auth/me` | `GET` | `STUDENT` or `ADMIN` | `401 Unauthorized` | N/A | Alias for `/session`. |
| **Player Operations** | | | | | |
| `/api/v1/player/me` | `GET` | `STUDENT` or `ADMIN` | `401 Unauthorized` | N/A | Resolves and returns authenticated player profile from request context. |
| `/api/v1/player/:id` | `GET` | `PUBLIC` / `STUDENT` | `200 OK` | N/A | Read-only view of public player statistics and leaderboard rank. |
| **Game Spawns & Claims** | | | | | |
| `/api/v1/spawns/active` | `GET` | `STUDENT` or `ADMIN` | `401 Unauthorized` | N/A | Query active spawn points currently available on campus. |
| `/api/v1/spawns/:id` | `GET` | `STUDENT` or `ADMIN` | `401 Unauthorized` | N/A | Inspect parameters of an active or recent spawn point. |
| `/api/v1/claims` | `POST` | `STUDENT` or `ADMIN` | `401 Unauthorized` | N/A | Submit claim mutation with authoritative geospatial GPS validation. |
| `/api/v1/claims/history` | `GET` | `STUDENT` or `ADMIN` | `401 Unauthorized` | N/A | Read historical claims list for the authenticated player. |
| **Campus Zones & Leaderboard** | | | | | |
| `/api/v1/leaderboard` | `GET` | `PUBLIC` / `STUDENT` | `200 OK` | N/A | Read-only leaderboard rankings for the current weekly cycle. |
| `/api/v1/zones` | `GET` | `PUBLIC` | `200 OK` | N/A | Read-only geographic zone polygons and bounding boxes. |
| `/api/v1/zones/:id` | `GET` | `PUBLIC` | `200 OK` | N/A | Detailed geographic parameters of a specific campus zone. |
| **Administrative Operations (Server-Controlled ADMIN ONLY)** | | | | | |
| `/api/v1/admin/overview` | `GET` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | System dashboard metrics (spawn counts, claim velocity, cycles). |
| `/api/v1/admin/spawns` | `POST` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Privileged spawn point creation. |
| `/api/v1/admin/spawns/:id` | `PUT` / `PATCH` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Privileged spawn point parameter and location editing. |
| `/api/v1/admin/spawns/:id/toggle` | `PATCH` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Enables, disables, or quarantines a specific campus spawn point. |
| `/api/v1/admin/rotation/config` | `GET` / `PUT` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Reads or updates spawn rotation parameters (interval, count). |
| `/api/v1/admin/rotate` | `POST` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Manually forces an immediate spawn batch rotation cycle. |
| `/api/v1/admin/cycles/config` | `GET` / `PUT` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Reads or updates weekly reset configuration and cycle timing. |
| `/api/v1/admin/cycles/reset` | `POST` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Manually triggers immediate weekly cycle reset. |
| `/api/v1/admin/settings` | `GET` / `PUT` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Inspects or updates runtime game parameters (claim radius, cooldowns). |
| `/api/v1/admin/audit-logs` | `GET` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Queries immutable administrator action audit trails. |
| `/api/v1/admin/analytics` | `GET` | `ADMIN` | `401 Unauthorized` | `403 Forbidden` | Queries aggregated gameplay telemetry and heatmap statistics. |

---

## 6. Middleware Implementation Architecture

Authorization is enforced via composable middleware handlers executed in strict sequence:

```
Incoming Request
      │
      ▼
cookieParserMiddleware       (Parses standard Cookie headers into req.cookies)
      │
      ▼
createAuthMiddleware         (Validates Bearer JWT, verifies signature & expiry, populates req.user)
      │  └── If invalid/missing: 401 Unauthorized (RFC 7807)
      │
      ▼
requireRole / requireAdmin   (Inspects req.user.role against allowed roles)
      │  └── If role not permitted: 403 Forbidden (RFC 7807)
      │
      ▼
Controller Route Handler     (Executes domain logic with guaranteed identity & role context)
```

### Middleware Definitions

```typescript
// server/middlewares/auth.ts

/**
 * Role-based Authorization Middleware Guard.
 * Ensures the authenticated user possesses at least one of the permitted roles.
 * Must be mounted AFTER authentication middleware (createAuthMiddleware).
 */
export function requireRole(...allowedRoles: ('STUDENT' | 'ADMIN')[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(
        new ForbiddenError(
          `Access denied: Operation requires one of [${allowedRoles.join(', ')}] role. Current role: ${req.user.role}`,
          {
            requiredRoles: allowedRoles,
            currentRole: req.user.role,
          }
        )
      );
      return;
    }

    next();
  };
}

/**
 * Convenience guard for administrator-only operations.
 */
export function requireAdmin() {
  return requireRole('ADMIN');
}
```

---

## 7. Error & RFC 7807 Problem Details Standard

All authorization failures are surfaced consistently using RFC 7807 problem details JSON format.

### 401 Unauthorized (Missing or Invalid Authentication)
Returned when a protected route is requested without a valid session token:
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required: Missing Authorization header",
    "timestamp": "2026-09-13T01:00:00.000Z"
  }
}
```

### 403 Forbidden (Authenticated but Insufficient Role)
Returned when an authenticated `STUDENT` attempts to access an `ADMIN`-only resource:
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Access denied: Operation requires one of [ADMIN] role. Current role: STUDENT",
    "details": {
      "requiredRoles": ["ADMIN"],
      "currentRole": "STUDENT"
    },
    "timestamp": "2026-09-13T01:00:00.000Z"
  }
}
```

---

## 8. Summary of Architectural Guarantees

1. **Strictly 2 Roles**: Only `STUDENT` and `ADMIN` exist across domain entities, JWT payloads, and DTOs.
2. **Deterministic Role Assignment**: Users default to `STUDENT`; administrative elevation requires an explicit, active row in `admins`.
3. **No Role Parameterization**: Roles are never parsed or accepted from HTTP query/body payloads.
4. **Independent Privilege Revocation**: Revoking an admin via `admins.revoked_at = NOW()` immediately strips administrative capabilities on subsequent token issuance without deleting the user's gameplay history.

---

## 9. Privileged Operations Audit Logging (Phase 04)

All administrative mutations (creation, modification, toggling, forced rotations, cycle resets, and settings updates) are authoritatively recorded in the PostgreSQL `audit_logs` table.

### Audit Log Schema (`audit_logs`)

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NULL,  -- Made nullable in migration 005 to record unauthenticated probes
  action VARCHAR(64) NOT NULL,
  target_entity VARCHAR(64) NOT NULL,
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_audit_logs_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_audit_logs_action_format CHECK (action ~ '^[A-Z0-9_]+$')
);
```

### Sanitization & Secret Redaction Guarantees

To ensure full compliance with privacy and security requirements, sensitive secrets are **strictly scrubbed** recursively prior to persistence:
- **Passwords**: `password`, `newPassword`, `currentPassword`, `confirmPassword` -> `[REDACTED]`
- **OAuth Secrets**: `client_secret`, `code`, `code_verifier`, `oauth_token`, `state` -> `[REDACTED]`
- **Session Secrets**: `sessionSecret`, `session_token`, `sessionId`, `cookie`, `connect.sid` -> `[REDACTED]`
- **Access Tokens**: `authorization`, `access_token`, `refreshToken`, `token`, `id_token`, Bearer/JWT formats -> `[REDACTED]`
- **Web Push Credentials**: `auth` keys, `p256dh` public keys, sensitive endpoint parameters -> `[REDACTED]`
- **Sensitive HTTP Headers**: `authorization`, `cookie`, `set-cookie`, `x-csrf-token` -> Stripped completely from metadata.

### Non-Intrusive Middleware Architecture

Audit logging is decoupled from controllers via reusable Express middleware:
- `auditAdminMutations(auditService: IAuditService)`: Mounted at the router level before `requireAdmin`. Hooks into Express response lifecycle (`res.on('finish')`) and records the final result (`SUCCESS`, `DENIED`, `FAILED`), execution time, HTTP status code, acting user ID, and sanitized payload without altering domain or game logic.
- `auditAdminAction(auditService: IAuditService, options: AuditActionOptions)`: Route-level helper for declaring explicit audit metadata.

---

## 10. Security Audit & Threat Verification (Phase 05)

The authorization and audit subsystem has been verified against all primary threat vectors:

| Threat Vector | Attack Scenario | Defense Mechanism | Verified Outcome |
| :--- | :--- | :--- | :--- |
| **Unauthenticated Probe** | Unauthenticated user calls `GET` or `POST` on admin endpoint | `requireAdmin` fails early on missing auth header | HTTP 401 Unauthorized; logged as `DENIED` with `admin_id = NULL` |
| **Unauthorized Student Access** | Student token calls admin query or mutation | `requireAdmin` checks role in server JWT, detects `STUDENT` | HTTP 403 Forbidden; logged as `DENIED` with student's user ID |
| **Role Forgery (Body/Query)** | Client injects `{ role: 'ADMIN' }` in request body/query | Zero-trust payload policy; role strictly resolved server-side | HTTP 403 Forbidden; body role completely ignored |
| **Role Forgery (Headers)** | Client injects `X-User-Role: ADMIN` header | Request headers ignored for role determination | HTTP 403 Forbidden |
| **Cryptographic Signature Forgery** | Attacker crafts JWT with `role: 'ADMIN'` signed with wrong secret | `JwtUtils.verify` rejects signature mismatch | HTTP 401 Unauthorized |
| **User ID Spoofing** | Student requests `/api/v1/player/me?userId=<admin_uuid>` | Zero-trust user resolution derives actor strictly from authenticated session | Returns student profile; spoofed ID ignored |
| **Expired Session Abuse** | Expired admin token attempts mutation | Token expiration check fails | HTTP 401 Unauthorized (`TOKEN_EXPIRED`) |
| **Secret Leakage in Audit Trail** | Mutation request body contains passwords, tokens, push credentials | Recursive sanitizer redacts all sensitive keys and values | Persisted log contains `[REDACTED]`; no raw secrets |
| **Slug Target IDs** | Route targeted non-UUID slug (`spawn-omega`) | Target ID validator stores valid UUIDs in `target_id`, saves slugs in `details.targetIdentifier` | PostgreSQL column constraints satisfied; no DB crash |
| **Information Leakage** | Forbidden/Unauthorized error inspection | Centralized `errorHandler` returns RFC 7807 problem details | Zero stack traces, SQL strings, or credential hints leaked |
