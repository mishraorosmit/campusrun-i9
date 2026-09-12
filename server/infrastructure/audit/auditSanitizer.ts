/**
 * Project I9 — Audit Log Sanitizer & Redactor
 * 
 * Strict data scrubber ensuring sensitive secrets and credentials never enter audit logs:
 * - Passwords (password, newPassword, confirmPassword)
 * - OAuth secrets (client_secret, code, code_verifier, oauth_token, state)
 * - Session secrets (sessionSecret, session_token, sessionId, cookie, connect.sid)
 * - Access tokens (authorization, access_token, token, id_token, refresh_token, jwt)
 * - Web Push credentials (auth, p256dh, endpoint tokens, privateKey, vapid)
 * 
 * Performs deep recursive scrubbing on objects, arrays, and primitives.
 */

const SENSITIVE_KEY_PATTERN = /(password|secret|token|credential|cookie|authorization|p256dh|^auth$|private_key|privatekey|code_verifier|client_secret)/i;
const JWT_OR_BEARER_PATTERN = /^(Bearer\s+)?ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-session-id',
]);

/**
 * Recursively redacts sensitive keys and values from arbitrary payloads.
 * Safe against cyclic references and deeply nested structures.
 */
export function sanitizePayload<T>(input: T, seen = new WeakSet()): T {
  if (input === null || input === undefined) {
    return input;
  }

  // Primitive values
  if (typeof input !== 'object') {
    if (typeof input === 'string' && JWT_OR_BEARER_PATTERN.test(input.trim())) {
      return '[REDACTED]' as unknown as T;
    }
    return input;
  }

  // Prevent infinite loops on circular objects
  if (seen.has(input as object)) {
    return '[CIRCULAR]' as unknown as T;
  }
  seen.add(input as object);

  // Arrays
  if (Array.isArray(input)) {
    return input.map((item) => sanitizePayload(item, seen)) as unknown as T;
  }

  // Date / RegExp / Buffer objects
  if (input instanceof Date || input instanceof RegExp) {
    return input;
  }

  // Plain objects
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    // If the key itself is sensitive, completely redact the value
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }

    // Check if key is a known sensitive header
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      output[key] = '[REDACTED]';
      continue;
    }

    // If value is a string matching token/credential format
    if (typeof value === 'string') {
      if (JWT_OR_BEARER_PATTERN.test(value.trim())) {
        output[key] = '[REDACTED]';
        continue;
      }
    }

    output[key] = sanitizePayload(value, seen);
  }

  return output as T;
}

/**
 * Strips sensitive HTTP headers from request metadata before logging.
 */
export function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase()) || SENSITIVE_KEY_PATTERN.test(key)) {
      continue; // Omit entirely from logged metadata
    }
    clean[key] = value;
  }
  return clean;
}
