import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      cookies?: Record<string, string>;
    }
  }
}

/**
 * Lightweight, zero-dependency cookie parser middleware.
 * Parses standard Cookie request headers into req.cookies dictionary.
 */
export function cookieParserMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const cookieHeader = req.headers.cookie;
  req.cookies = {};

  if (cookieHeader) {
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx !== -1) {
        const key = pair.substring(0, idx).trim();
        const val = pair.substring(idx + 1).trim();
        try {
          req.cookies[key] = decodeURIComponent(val);
        } catch {
          req.cookies[key] = val;
        }
      }
    }
  }

  next();
}
