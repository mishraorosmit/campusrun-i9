import { AppError } from './AppError';
import { ErrorCodes } from './ErrorCodes';

/**
 * Thrown when a pure domain or game rule is violated (e.g. out of range, cooldown, already claimed).
 */
export class DomainError extends AppError {
  public readonly statusCode = 422;
  public readonly code: ErrorCodes;

  constructor(message: string, code: ErrorCodes = ErrorCodes.DOMAIN_ERROR, details?: unknown) {
    super(message, details, true);
    this.code = code;
  }
}
