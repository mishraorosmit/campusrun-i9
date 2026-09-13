import { Request, Response, NextFunction } from 'express';
import { JwtUtils, JwtPayload } from '../infrastructure/auth/JwtUtils';
import { UnauthorizedError, ForbiddenError } from '../errors';
import { config } from '../config';

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  role: 'STUDENT' | 'ADMIN' | 'player' | 'admin' | 'superadmin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export { JwtUtils };
export type { JwtPayload };

/**
 * Programmatically verifies a JWT token string and extracts the user identity payload.
 * Useful for WebSocket handshakes (Socket.IO auth), background workers, and Express middleware.
 */
export function verifyToken(token: string, jwtSecret: string = config.JWT_SECRET): AuthenticatedUser {
  const payload: JwtPayload = JwtUtils.verify(token, jwtSecret);
  return {
    id: payload.sub,
    email: payload.email,
    username: payload.username,
    role: payload.role as any,
  };
}

/**
 * Creates authentication middleware with configured JWT secret.
 * Enforces valid Bearer JWT on protected endpoints.
 */
export function createAuthMiddleware(jwtSecret: string = config.JWT_SECRET) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      next(new UnauthorizedError('Authentication required: Missing Authorization header'));
      return;
    }

    const match = authHeader.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      next(new UnauthorizedError('Invalid authorization format: Expected "Bearer <token>"'));
      return;
    }

    const token = match[1];

    try {
      const payload: JwtPayload = JwtUtils.verify(token, jwtSecret);
      req.user = {
        id: payload.sub,
        email: payload.email,
        username: payload.username,
        role: payload.role as any,
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
 * Reusable authentication middleware.
 * Verifies session, resolves current user, and attaches identity to request context.
 * Rejects unauthenticated requests consistently with 401 Unauthorized.
 */
export const requireAuthenticatedUser = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user) {
    return next();
  }
  return createAuthMiddleware(config.JWT_SECRET)(req, res, next);
};

export const requireCurrentUser = requireAuthenticatedUser;

/**
 * Optional authentication middleware: parses JWT if present, but does not block if missing.
 */
export function createOptionalAuthMiddleware(jwtSecret: string = config.JWT_SECRET) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return next();
    }

    const match = authHeader.match(/^Bearer\s+(\S+)$/i);
    if (match) {
      try {
        const payload: JwtPayload = JwtUtils.verify(match[1], jwtSecret);
        req.user = {
          id: payload.sub,
          email: payload.email,
          username: payload.username,
          role: payload.role as any,
        };
      } catch {
        // Ignore parsing errors for optional auth
      }
    }

    next();
  };
}

/**
 * Role-based Authorization Middleware Guard.
 * Ensures the authenticated user possesses at least one of the permitted roles.
 * Authenticates automatically if not already authenticated.
 */
export function requireRole(...allowedRoles: ('STUDENT' | 'ADMIN' | 'player' | 'admin' | 'superadmin')[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      requireAuthenticatedUser(req, res, (err) => {
        if (err) {
          return next(err);
        }
        checkRole();
      });
    } else {
      checkRole();
    }

    function checkRole() {
      const userRole = req.user?.role;
      const matches = userRole && allowedRoles.some((r) => r.toUpperCase() === userRole.toUpperCase());
      if (!req.user || !matches) {
        return next(
          new ForbiddenError(
            `Access denied: Operation requires one of [${allowedRoles.join(', ')}] role. Current role: ${req.user?.role || 'NONE'}`,
            {
              requiredRoles: allowedRoles,
              currentRole: req.user?.role,
            }
          )
        );
      }
      next();
    }
  };
}

/**
 * Administrative Authorization Guard.
 * Enforces that the request is authenticated AND possesses the server-controlled 'ADMIN' role.
 * - unauthenticated request → 401 Unauthorized
 * - authenticated STUDENT → 403 Forbidden
 * - authenticated ADMIN → access granted
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  return requireRole('ADMIN', 'admin', 'superadmin')(req, res, next);
};

/**
 * Creates admin authorization middleware requiring valid JWT and admin role.
 */
export function createAdminAuthMiddleware(jwtSecret: string = config.JWT_SECRET) {
  const authMiddleware = createAuthMiddleware(jwtSecret);
  return (req: Request, res: Response, next: NextFunction): void => {
    authMiddleware(req, res, (err) => {
      if (err) {
        return next(err);
      }
      const role = req.user?.role?.toUpperCase();
      if (!req.user || (role !== 'ADMIN' && role !== 'SUPERADMIN')) {
        return next(new ForbiddenError('Admin privileges required to access this resource'));
      }
      next();
    });
  };
}
