import { Request, Response, NextFunction } from 'express';
import { JwtUtils, JwtPayload } from '../infrastructure/auth/JwtUtils';
import { UnauthorizedError } from '../errors';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Creates authentication middleware with configured JWT secret.
 * Enforces valid Bearer JWT on protected endpoints.
 */
export function createAuthMiddleware(jwtSecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      next(new UnauthorizedError('Authentication required: Missing Authorization header'));
      return;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      next(new UnauthorizedError('Invalid authorization format: Expected "Bearer <token>"'));
      return;
    }

    const token = parts[1];

    try {
      const payload: JwtPayload = JwtUtils.verify(token, jwtSecret);
      req.user = {
        id: payload.sub,
        email: payload.email,
        username: payload.username,
        role: payload.role,
      };
      next();
    } catch (err: any) {
      if (err.expired) {
        next(new UnauthorizedError('Access token expired', { reason: 'TOKEN_EXPIRED' }));
      } else {
        next(new UnauthorizedError('Invalid access token signature or payload'));
      }
    }
  };
}

/**
 * Optional authentication middleware: parses JWT if present, but does not block if missing.
 */
export function createOptionalAuthMiddleware(jwtSecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return next();
    }

    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      try {
        const payload: JwtPayload = JwtUtils.verify(parts[1], jwtSecret);
        req.user = {
          id: payload.sub,
          email: payload.email,
          username: payload.username,
          role: payload.role,
        };
      } catch {
        // Ignore parsing errors for optional auth
      }
    }

    next();
  };
}
