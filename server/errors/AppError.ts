import { ErrorCodes } from './ErrorCodes';

/**
 * Base Application Error
 * All domain, validation, and operational errors extend this class.
 */
export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly code: ErrorCodes;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(message: string, details?: unknown, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.isOperational = isOperational;

    // Restore prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  public toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: new Date().toISOString(),
    };
  }
}
