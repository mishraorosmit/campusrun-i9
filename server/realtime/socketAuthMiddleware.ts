import { Socket } from 'socket.io';
import { verifyToken, AuthenticatedUser } from '../middlewares/auth';
import { config } from '../config';

declare module 'socket.io' {
  interface SocketData {
    user: AuthenticatedUser;
    userId: string;
    role: string;
    username: string;
    email: string;
  }
}

/**
 * Socket.IO Handshake Authentication Middleware
 * Validates incoming WebSocket connection requests via JWT token.
 * Extracts token from handshake auth, authorization headers, or query parameters.
 */
export function socketAuthMiddleware(jwtSecret: string = config.JWT_SECRET) {
  return (socket: Socket, next: (err?: Error) => void): void => {
    try {
      let token: string | undefined;

      // 1. Extract from handshake.auth.token or handshake.auth.accessToken
      if (socket.handshake.auth && typeof socket.handshake.auth === 'object') {
        token = socket.handshake.auth.token || socket.handshake.auth.accessToken;
      }

      // 2. Fallback to handshake.headers.authorization ("Bearer <token>")
      if (!token && socket.handshake.headers && socket.handshake.headers.authorization) {
        const authHeader = socket.handshake.headers.authorization;
        const match = authHeader.match(/^Bearer\s+(\S+)$/i);
        if (match) {
          token = match[1];
        }
      }

      // 3. Fallback to handshake query parameter (?token=...)
      if (!token && socket.handshake.query && typeof socket.handshake.query.token === 'string') {
        token = socket.handshake.query.token;
      }

      if (!token) {
        const error = new Error('Authentication required: Missing token in handshake');
        (error as any).data = { code: 'UNAUTHORIZED', reason: 'MISSING_TOKEN' };
        return next(error);
      }

      // Verify JWT and extract user payload
      const user: AuthenticatedUser = verifyToken(token, jwtSecret);

      // Attach authenticated identity to socket.data
      socket.data.user = user;
      socket.data.userId = user.id;
      socket.data.role = user.role;
      socket.data.username = user.username;
      socket.data.email = user.email;

      next();
    } catch (err: any) {
      const isExpired = err.expired || err.message?.includes('expired');
      const error = new Error(
        isExpired
          ? 'Authentication error: Access token expired'
          : 'Authentication error: Invalid access token signature or payload'
      );
      (error as any).data = {
        code: 'UNAUTHORIZED',
        reason: isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      };
      next(error);
    }
  };
}
