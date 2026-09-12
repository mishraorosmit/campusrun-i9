import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
  InternalServerError,
  ErrorCodes,
} from '../../errors';

/**
 * Normalizes PostgreSQL errors into the application's typed error model.
 * Prevents leaking raw SQL statements, table structures, or credentials to clients.
 */
export function normalizeDatabaseError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const pgError = error as {
    code?: string;
    message?: string;
    detail?: string;
    constraint?: string;
    table?: string;
    column?: string;
  };

  const code = pgError?.code;

  switch (code) {
    case '23505': // unique_violation
      return new ConflictError(
        'A record with these unique attributes already exists.',
        { constraint: pgError.constraint }
      );

    case '23503': // foreign_key_violation
      return new NotFoundError(
        'Referenced entity does not exist.',
        { constraint: pgError.constraint }
      );

    case '23514': // check_violation
      return new ValidationError(
        'Database validation constraint failed.',
        { constraint: pgError.constraint }
      );

    case '23502': // not_null_violation
      return new ValidationError(
        'Required field cannot be null.',
        { column: pgError.column }
      );

    case '40001': // serialization_failure (concurrency conflict)
    case '40P01': // deadlock_detected
      return new ConflictError(
        'Concurrent database transaction conflict detected. Please retry.',
        { code: ErrorCodes.CONFLICT }
      );

    case '57014': // query_canceled / statement_timeout
      return new InternalServerError(
        'Database query execution timed out.',
        { code: ErrorCodes.INTERNAL_SERVER_ERROR }
      );

    case '08001': // unable_to_establish_sqlconnection
    case '08003': // connection_does_not_exist
    case '08006': // connection_failure
    case '08007': // transaction_resolution_unknown
    case 'ECONNREFUSED':
      return new InternalServerError(
        'Database service is currently unreachable.',
        { code: ErrorCodes.SERVICE_UNAVAILABLE }
      );

    default:
      console.error('[PostgreSQL Database Error]:', error);
      return new InternalServerError(
        'An unexpected database error occurred.',
        { code: ErrorCodes.INTERNAL_SERVER_ERROR }
      );
  }
}
