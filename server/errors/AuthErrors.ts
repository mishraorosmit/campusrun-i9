import { AppError } from './AppError';
import { ErrorCodes } from './ErrorCodes';

/**
 * Thrown when an unauthenticated request attempts to access a protected resource.
 */
export class UnauthorizedError extends AppError {
  public readonly statusCode = 401;
  public readonly code = ErrorCodes.UNAUTHORIZED;

  constructor(message = 'Authentication required', details?: unknown) {
    super(message, details, true);
  }
}

/**
 * Thrown when an authenticated entity lacks permission.
 */
export class ForbiddenError extends AppError {
  public readonly statusCode = 403;
  public readonly code = ErrorCodes.FORBIDDEN;

  constructor(message = 'Access denied', details?: unknown) {
    super(message, details, true);
  }
}

/**
 * Thrown when a state conflict occurs (e.g. duplicate active claim).
 */
export class ConflictError extends AppError {
  public readonly statusCode = 409;
  public readonly code = ErrorCodes.CONFLICT;

  constructor(message: string, details?: unknown) {
    super(message, details, true);
  }
}

/**
 * Thrown for unexpected system/infrastructure failures.
 */
export class InternalServerError extends AppError {
  public readonly statusCode = 500;
  public readonly code = ErrorCodes.INTERNAL_SERVER_ERROR;

  constructor(message = 'Internal server error occurred', details?: unknown) {
    super(message, details, false);
  }
}
