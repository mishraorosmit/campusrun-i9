import { Request, Response, NextFunction } from 'express';
import { NotFoundError } from '../errors';

/**
 * Forwards 404 Not Found as an AppError to the centralized error handler.
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Endpoint ${req.method} ${req.originalUrl} not found.`));
}
