import { AppError } from './AppError';
import { ErrorCodes } from './ErrorCodes';

/**
 * Thrown when request payload or parameters fail schema validation.
 */
export class ValidationError extends AppError {
  public readonly statusCode = 400;
  public readonly code = ErrorCodes.VALIDATION_ERROR;

  constructor(message: string, details?: unknown) {
    super(message, details, true);
  }
}
