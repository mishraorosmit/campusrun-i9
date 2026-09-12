import { AppError } from './AppError';
import { ErrorCodes } from './ErrorCodes';

/**
 * Thrown when a requested resource is not found.
 */
export class NotFoundError extends AppError {
  public readonly statusCode = 404;
  public readonly code = ErrorCodes.NOT_FOUND;

  constructor(message: string, details?: unknown) {
    super(message, details, true);
  }
}
