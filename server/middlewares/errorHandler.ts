import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { ErrorCodes } from '../errors/ErrorCodes';

/**
 * Global Centralized Error Handling Middleware
 * Converts AppError and unexpected exceptions into RFC 7807 problem details JSON format.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.toJSON(),
    });
    return;
  }

  // Unhandled operational / programming exceptions
  console.error('[Unhandled Internal Error]:', err);

  res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_SERVER_ERROR,
      message: 'An unexpected internal server error occurred.',
      timestamp: new Date().toISOString(),
    },
  });
}
