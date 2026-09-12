# Campus Run (Project I9) — Authentication Architecture Specification

> **Status:** Phase 01 Complete — Authentication Architecture Defined  
> **Identity Provider:** Google Identity (OAuth 2.0 / OpenID Connect - OIDC)  
> **Target Audience:** College Students & Campus Faculty with verified institutional email domains  
> **Standard:** RFC 6749 (OAuth 2.0), OpenID Connect Core 1.0, RFC 7519 (JSON Web Tokens)  
> **Persistence Standard:** Authoritative `users` and `profiles` relational schema (PostgreSQL 16+)  

---

## 1. Executive Summary & Design Principles

Authentication in Project I9 establishes trusted player identity while preserving campus competition integrity. Because Campus Run rewards physical exploration and competitive leaderboard progression within a specific physical college campus, authentication enforces a strict **institutional campus boundary**.

### Core Architecture Pillars:
1. **Google OAuth 2.0 / OpenID Connect (OIDC):** Offloads password storage, MFA, and credential compromises entirely to Google's battle-tested identity infrastructure.
2. **Server-Side Authoritative Domain Validation:** The allowed college email domain (e.g., `@campus.edu`) is configured **strictly on the backend**. Frontend clients never determine domain eligibility, and Google token claims are cryptographically verified server-side.
3. **Idempotent User & Profile Provisioning:** First-time authentication automatically and transactionally provisions both a `users` record (auth identity) and a corresponding `profiles` record (game persona), assigning a sanitized unique public handle.
4. **Stateless JWT + Rotating Refresh Cookie Session Strategy:**
   - **Short-Lived Access Token:** 15-minute cryptographically signed JWT for low-latency stateless authorization across API routes.
   - **Long-Lived Refresh Token:** 7-day cryptographically random opaque token stored in an `httpOnly`, `Secure`, `SameSite=Strict` cookie, accompanied by single-use token rotation and database-backed revocation.
5. **Clear Boundary Separation:** Domain logic, controllers, and services remain decoupled from HTTP cookie handling and third-party Google SDKs through service and repository abstractions.

---

## 2. Google OAuth 2.0 / OIDC Flow Architecture

Project I9 supports both standard Authorization Code flow (with PKCE for mobile/web apps) and direct OIDC ID Token credential exchange (for modern One Tap / Sign-In with Google web buttons).

```
   ┌────────┐                ┌──────────────┐                ┌───────────────┐
   │ Player │                │  I9 Backend  │                │ Google Identity│
   │ Client │                │   /api/v1    │                │  OAuth / OIDC │
   └───┬────┘                └──────┬───────┘                └───────┬───────┘
       │                            │                                │
       │ 1. Initiate Google Login   │                                │
       │    (Redirect or One Tap)   │                                │
       │────────────────────────────────────────────────────────────>│
       │                            │                                │
       │ 2. Player Authenticates & Consents                          │
       │    (selects @college.edu)  │                                │
       │<────────────────────────────────────────────────────────────│
       │                            │                                │
       │ 3. Returns auth_code       │                                │
       │    OR id_token             │                                │
       │───────────────────────────>│                                │
       │                            │ 4. Exchange code / Verify OIDC │
       │                            │    token against Google JWKS   │
       │                            │───────────────────────────────>│
       │                            │ 5. Returns validated claims    │
       │                            │    (email, sub, verified, etc.)│
       │                            │<───────────────────────────────│
       │                            │                                │
       │                            │ 6. Validate College Domain     │
       │                            │    Check status != suspended   │
       │                            │    Provision user + profile    │
       │                            │    Issue Access JWT + Refresh  │
       │ 7. Set-Cookie: refresh_token (httpOnly)                     │
       │    Response: { accessToken, user, profile }                 │
       │<───────────────────────────│                                │
```

---

## 3. Detailed Authentication Steps

### 3.1 Step 1: Authorization Initiation
- **Web App Direct Flow:** Client initiates authentication by opening:
  `GET /api/v1/auth/google`
  Backend generates a cryptographic `state` and PKCE `code_challenge`, stores them in a temporary short-lived session cookie, and redirects to:
  ```
  https://accounts.google.com/o/oauth2/v2/auth?
    client_id=${GOOGLE_CLIENT_ID}&
    redirect_uri=${APP_URL}/api/v1/auth/google/callback&
    response_type=code&
    scope=openid%20email%20profile&
    state=${state}&
    code_challenge=${challenge}&
    code_challenge_method=S256&
    hd=${AUTH_COLLEGE_DOMAIN}
  ```
  *Note:* The `hd` (hosted domain) parameter provides a client hint to Google to prioritize the college account, but **server-side validation remains strictly authoritative**.

- **Google One Tap / Credential Flow:** Modern single-page clients can also receive an `id_token` directly via Google Identity Services (GIS) and submit it to:
  `POST /api/v1/auth/google/verify-token` with `{ "idToken": "..." }`.

### 3.2 Step 2: Server-Side Identity Verification
The backend receives either:
1. `code` at `/api/v1/auth/google/callback` (exchanged with Google's token endpoint `https://oauth2.googleapis.com/token`).
2. `id_token` at `/api/v1/auth/google/verify-token`.

Verification guarantees:
- Token signature is verified against Google's public JSON Web Key Set (`https://www.googleapis.com/oauth2/v3/certs`) with automatic key caching and rotation.
- Token `aud` (audience) strictly matches `GOOGLE_CLIENT_ID`.
- Token `iss` (issuer) is `https://accounts.google.com` or `accounts.google.com`.
- Token `exp` is in the future.
- `email_verified` claim must be strictly `true`.

### 3.3 Step 3: Authoritative College Domain Validation
The verified email address is validated against backend configuration:
```typescript
const email = payload.email.toLowerCase().trim();
const allowedDomain = config.AUTH_COLLEGE_DOMAIN.toLowerCase().trim(); // e.g. "campus.edu"

// Extract exact domain part after '@'
const emailDomain = email.split('@')[1];

if (!emailDomain || emailDomain !== allowedDomain) {
  throw new UnauthorizedError(
    `Access restricted to official @${allowedDomain} institutional email accounts.`,
    { receivedEmail: email, requiredDomain: allowedDomain }
  );
}
```
**Strict Security Rules:**
- The allowed domain is configured **only** in backend environment variables (`AUTH_COLLEGE_DOMAIN`), never delivered or accepted from the frontend.
- Subdomains (e.g. `alumni.campus.edu` vs `student.campus.edu`) must either match the explicit allowed domain or be validated against an authorized domain whitelist.
- If email is not verified by Google (`email_verified !== true`), access is rejected immediately.

---

## 4. User Creation & Profile Provisioning Flow

Authentication integrates directly with the existing `users` and `profiles` database tables established in Phase 02:

```
                  Verified Google Identity (email, sub, name, picture)
                                        │
                                        ▼
               ┌──────────────────────────────────────────────────┐
               │ Check if user exists in `users` by email         │
               └────────────────────────┬─────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
             Exists │                                       │ Does NOT Exist
                    ▼                                       ▼
    ┌───────────────────────────────┐       ┌────────────────────────────────┐
    │ 1. Verify user status         │       │ 1. Transaction BEGIN           │
    │    - If suspended/deactivated │       │ 2. Insert into `users`:        │
    │      THEN throw ForbiddenError│       │    - email                     │
    │ 2. Update `email_verified_at` │       │    - status: 'active'          │
    │    if not already populated   │       │    - email_verified_at: NOW()  │
    │ 3. Update `profiles`:         │       │ 3. Generate initial username   │
    │    - `last_active_at`: NOW()  │       │    from email prefix           │
    │    - `avatar_url`: Google pic │       │    (sanitize + de-duplicate)   │
    │      (if currently null)      │       │ 4. Insert into `profiles`:     │
    └───────────────┬───────────────┘       │    - user_id, username,        │
                    │                       │      avatar_url, display_name  │
                    │                       │ 5. Transaction COMMIT          │
                    │                       └────────────────┬───────────────┘
                    └───────────────────┬────────────────────┘
                                        │
                                        ▼
                     Issue Access Token + Set Refresh Cookie
```

### 4.1 Username De-Duplication Strategy
When creating a new profile from `student123@campus.edu`:
1. Sanitize local part: strip non-alphanumerics, keep within `^[a-zA-Z0-9_]{3,24}$`.
2. Check `profiles(username)` uniqueness.
3. If collision occurs, append a random 4-digit alphanumeric suffix (e.g., `student123_a8f2`).
4. User can later customize their handle via `PATCH /api/v1/player/profile` subject to uniqueness constraints.

---

## 5. Session & Token Strategy

Project I9 uses a hybrid stateless JWT + stateful refresh token approach:

### 5.1 Access Token (Stateless JWT)
- **Lifetime:** 15 minutes (`900` seconds).
- **Signing Algorithm:** HMAC-SHA256 (`HS256`) using `JWT_SECRET`.
- **Payload Claims:**
  ```json
  {
    "sub": "365f93cf-2a47-49d7-af2d-d8e44d67c9e1",
    "email": "student@campus.edu",
    "username": "speedy_runner",
    "role": "player",
    "iat": 1757721600,
    "exp": 1757722500
  }
  ```
- **Transmission:** HTTP Request Header: `Authorization: Bearer <accessToken>`.

### 5.2 Refresh Token (Opaque Token in HttpOnly Cookie)
- **Lifetime:** 7 days (`604800` seconds).
- **Format:** 256-bit cryptographically secure random string (`crypto.randomBytes(32).toString('hex')`).
- **Cookie Security Attributes:**
  - `HttpOnly: true` (inaccessible to browser JavaScript, immune to XSS theft).
  - `Secure: true` in production (enforced over HTTPS).
  - `SameSite: Strict` (mitigates CSRF vulnerabilities).
  - `Path: /api/v1/auth` (cookie transmitted only to auth management routes: refresh and logout).

### 5.3 Token Refresh & Single-Use Rotation
To prevent refresh token replay attacks:
1. When client calls `POST /api/v1/auth/refresh`, the presented refresh token is exchanged.
2. An updated refresh token is issued, and the previous refresh token is invalidated.
3. If an already-invalidated refresh token is presented, the backend treats this as a breach attempt and revokes all active sessions for that user.

### 5.4 Logout
- Client calls `POST /api/v1/auth/logout`.
- Backend marks the refresh token invalid.
- Backend clears the cookie with `Set-Cookie: refreshToken=; Max-Age=0; Path=/api/v1/auth; HttpOnly; SameSite=Strict`.

---

## 6. Authentication Middleware & Pipeline

```typescript
export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  role: 'player' | 'admin' | 'superadmin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
```

### Middleware Execution Logic:
1. Extract `Authorization` header. If missing or malformed:
   - For protected routes: reject with `401 Unauthorized` (`UNAUTHORIZED`).
   - For optional-auth routes: continue with `req.user = undefined`.
2. Verify JWT signature with `JWT_SECRET`.
3. Check expiration. If expired: reject with `401 Unauthorized` with `details: { reason: 'TOKEN_EXPIRED' }` so client can trigger silent refresh.
4. Populate `req.user` with decoded user payload.
5. Hand off to controller.

---

## 7. Configuration Schema Additions

The environment validation schema (`server/config/env.ts`) must be extended with the following required auth parameters:

```typescript
export interface AuthConfig {
  // Google OAuth Credentials
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_CALLBACK_URL: string;

  // Institutional Boundary
  AUTH_COLLEGE_DOMAIN: string; // e.g., "campus.edu"

  // Token Cryptography
  JWT_SECRET: string;
  JWT_ACCESS_EXPIRATION_SECONDS: number; // default: 900 (15 min)
  REFRESH_TOKEN_EXPIRATION_SECONDS: number; // default: 604800 (7 days)
}
```

Fail-fast startup guarantees:
- Application fails to start if `GOOGLE_CLIENT_ID` or `JWT_SECRET` is missing.
- Application fails to start if `AUTH_COLLEGE_DOMAIN` is empty or invalid format.
- In `production`, `JWT_SECRET` must be at least 32 characters long.

---

## 8. Authentication Error Response Catalog

All authentication failures conform strictly to the I9 `AppError` response envelope:

```json
{
  "code": "UNAUTHORIZED",
  "message": "Human-readable explanation",
  "details": {},
  "timestamp": "2026-09-13T00:30:00.000Z"
}
```

| HTTP Status | ErrorCode | Scenario / Cause | Client Action |
| :--- | :--- | :--- | :--- |
| `401` | `UNAUTHORIZED` | Missing `Authorization` header or invalid bearer format | Redirect to login |
| `401` | `UNAUTHORIZED` | Expired Access JWT (`details: { reason: 'TOKEN_EXPIRED' }`) | Request silent token refresh via `/auth/refresh` |
| `401` | `UNAUTHORIZED` | Invalid or expired refresh token cookie | Clear tokens & redirect to login |
| `403` | `FORBIDDEN` | Google email does not belong to configured `AUTH_COLLEGE_DOMAIN` | Display domain restriction notice to student |
| `403` | `FORBIDDEN` | Google account email not verified (`email_verified !== true`) | Prompt user to verify email with Google |
| `403` | `FORBIDDEN` | User status is `suspended` or `deactivated` | Display disciplinary/support contact link |
| `400` | `BAD_REQUEST` | OAuth callback missing `code` or `state` parameter | Restart authentication flow |
| `502` | `SERVICE_UNAVAILABLE` | Failure to reach Google OAuth token endpoint / JWKS certs | Retry with exponential backoff |

---

## 9. API Route Specifications

All auth endpoints are mounted under `/api/v1/auth`:

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/auth/google` | Initiates OAuth flow, redirects user to Google consent screen | No |
| `GET` | `/api/v1/auth/google/callback` | OAuth redirect callback receiver; validates code, creates/logs in user | No |
| `POST` | `/api/v1/auth/google/verify-token` | Exchange Google One Tap / GIS ID Token for session tokens | No |
| `POST` | `/api/v1/auth/refresh` | Exchange `httpOnly` refresh cookie for a fresh access token | Cookie |
| `POST` | `/api/v1/auth/logout` | Revoke current refresh token and clear auth cookies | Cookie |
| `GET` | `/api/v1/auth/me` | Fetch authenticated player profile and identity info | Yes (JWT) |

---

## 10. Summary of Architectural Decisions

1. **Why Google OIDC instead of custom email/password?**
   - Eliminates database password credential theft, hashing complexity, and password reset email infrastructure.
   - Leverages Google Workspace for Education domain verification directly.
2. **Why server-side domain verification?**
   - Frontend validation can easily be bypassed with API inspection tools (cURL, Postman). Authoritative verification in the token exchange route guarantees that no non-campus email can obtain a valid JWT.
3. **Why HttpOnly cookies for refresh tokens but bearer tokens for access?**
   - Access tokens in memory avoid CSRF vulnerability during standard API calls.
   - HttpOnly cookies prevent XSS exfiltration of persistent refresh tokens.
4. **Why tie into `users` and `profiles` immediately?**
   - Every authenticated student is instantly ready to engage with the campus game loop (`spawns`, `claims`, `leaderboard`) with zero secondary onboarding friction.
