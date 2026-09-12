# Project I9 — Typed Error Model & HTTP Mapping

This document specifies the backend error hierarchy, machine-readable error codes, HTTP status mappings, and standard JSON response envelopes.

---

## 1. Design Principles

1. **RFC 7807 Compliant Envelopes:** All API errors return a uniform, predictable JSON shape across all endpoints.
2. **Domain Isolation:** Game rules throw domain-specific errors (`DomainError`) without knowing anything about HTTP status codes. The middleware layer translates domain codes into HTTP statuses.
3. **Structured Debug Details:** Validation issues and domain constraint failures include structured machine-readable metadata in the `details` field.
4. **Zero Unhandled Leaks:** Unhandled system exceptions are intercepted by the global error middleware and masked as `INTERNAL_SERVER_ERROR` (`500`) to prevent leaking internal stack traces.

---

## 2. Standard JSON Error Schema

Every error response adheres to the following contract:

```json
{
  "success": false,
  "error": {
    "code": "OUT_OF_RANGE",
    "message": "Player is out of range (42.5m away; maximum radius is 25m)",
    "details": {
      "distanceMeters": 42.5,
      "claimRadiusMeters": 25.0
    },
    "timestamp": "2026-09-12T17:35:12.950Z"
  }
}
```

---

## 3. Error Class Hierarchy & HTTP Status Mapping

```
AppError (Abstract, Base)
├── ValidationError          --> 400 Bad Request
├── UnauthorizedError        --> 401 Unauthorized
├── ForbiddenError           --> 403 Forbidden
├── NotFoundError            --> 404 Not Found
├── ConflictError            --> 409 Conflict
├── DomainError              --> 422 Unprocessable Entity
└── InternalServerError      --> 500 Internal Server Error
```

| Class | HTTP Status | Typical Error Codes | Description |
| :--- | :--- | :--- | :--- |
| **`ValidationError`** | `400 Bad Request` | `VALIDATION_ERROR`, `BAD_REQUEST` | Malformed parameters, missing fields, or out-of-range coordinates. |
| **`UnauthorizedError`** | `401 Unauthorized` | `UNAUTHORIZED` | Missing or invalid player authentication token. |
| **`ForbiddenError`** | `403 Forbidden` | `FORBIDDEN` | Authenticated player lacks required role (e.g. non-admin accessing admin endpoints). |
| **`NotFoundError`** | `404 Not Found` | `NOT_FOUND` | Requested spawn point, zone, or player profile does not exist. |
| **`ConflictError`** | `409 Conflict` | `CONFLICT` | Concurrent race condition or conflicting resource state. |
| **`DomainError`** | `422 Unprocessable Entity` | `OUT_OF_RANGE`, `SPAWN_NOT_ACTIVE`, `SPAWN_EXPIRED`, `ALREADY_CLAIMED`, `COOLDOWN_ACTIVE` | Violations of pure game rules (e.g. player too far away, already claimed in current rotation). |
| **`InternalServerError`** | `500 Internal Server Error` | `INTERNAL_SERVER_ERROR`, `SERVICE_UNAVAILABLE` | Unhandled runtime errors, database query failures, or infrastructure exceptions. |

---

## 4. Error Codes Catalog (`ErrorCodes` Enum)

- `VALIDATION_ERROR`
- `BAD_REQUEST`
- `NOT_FOUND`
- `CONFLICT`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `DOMAIN_ERROR`
- `OUT_OF_RANGE`
- `SPAWN_NOT_ACTIVE`
- `SPAWN_EXPIRED`
- `ALREADY_CLAIMED`
- `CLAIM_LIMIT_REACHED`
- `COOLDOWN_ACTIVE`
- `INTERNAL_SERVER_ERROR`
- `SERVICE_UNAVAILABLE`
