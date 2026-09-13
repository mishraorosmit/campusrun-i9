import http from 'http';
import { Server, ServerOptions, Socket } from 'socket.io';
import { socketAuthMiddleware } from './socketAuthMiddleware';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  REALTIME_ROOMS,
} from './events';
import { config } from '../config';

export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type AppSocketServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

class SocketManager {
  private io: AppSocketServer | null = null;
  private userSocketsMap: Map<string, Set<string>> = new Map();
  private socketToUserMap: Map<string, string> = new Map();

  /**
   * Initializes and attaches the Socket.IO server to an HTTP server instance.
   */
  public init(httpServer: http.Server, options: Partial<ServerOptions> = {}): AppSocketServer {
    if (this.io) {
      return this.io;
    }

    const defaultOptions: Partial<ServerOptions> = {
      cors: {
        origin: config.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 30000,
      pingInterval: 25000,
      transports: ['websocket', 'polling'],
      ...options,
    };

    this.io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
      httpServer,
      defaultOptions
    );

    // 1. Register Handshake Authentication Middleware
    this.io.use(socketAuthMiddleware(config.JWT_SECRET));

    // 2. Register Connection Lifecycle and Cleanup Handlers
    this.io.on('connection', (socket: AppSocket) => {
      const user = socket.data.user;
      if (!user) {
        socket.disconnect(true);
        return;
      }

      const userId = user.id;

      // In-memory socket tracking
      if (!this.userSocketsMap.has(userId)) {
        this.userSocketsMap.set(userId, new Set());
      }
      this.userSocketsMap.get(userId)!.add(socket.id);
      this.socketToUserMap.set(socket.id, userId);

      // Automatically join campus-wide broadcast room for all authenticated players
      socket.join(REALTIME_ROOMS.GLOBAL);

      // Automatically join player-specific room for targeted notifications & direct events
      socket.join(REALTIME_ROOMS.USER(userId));

      // Join privileged admin room if user has administrative permissions
      const roleUpper = user.role?.toUpperCase();
      if (roleUpper === 'ADMIN' || roleUpper === 'SUPERADMIN') {
        socket.join(REALTIME_ROOMS.ADMIN);
      }

      // Emit lightweight reconnect sync signal (Strictly NO full-state dump)
      const syncSignal = {
        last_updated_timestamp: new Date().toISOString(),
        serverTime: new Date().toISOString(),
      };
      socket.emit('reconnect:sync_required', syncSignal);

      // 3. Client Room Management & Sync Requests
      socket.on('room:join_zone', (zoneId: string, ack) => {
        if (zoneId && typeof zoneId === 'string') {
          const room = REALTIME_ROOMS.ZONE(zoneId);
          socket.join(room);
          if (typeof ack === 'function') {
            ack({ success: true, room });
          }
        }
      });

      socket.on('room:leave_zone', (zoneId: string, ack) => {
        if (zoneId && typeof zoneId === 'string') {
          const room = REALTIME_ROOMS.ZONE(zoneId);
          socket.leave(room);
          if (typeof ack === 'function') {
            ack({ success: true, room });
          }
        }
      });

      socket.on('reconnect:sync', (ack) => {
        const payload = {
          last_updated_timestamp: new Date().toISOString(),
          serverTime: new Date().toISOString(),
        };
        socket.emit('reconnect:sync_required', payload);
        if (typeof ack === 'function') {
          ack(payload);
        }
      });

      socket.on('ping', (ack) => {
        if (typeof ack === 'function') {
          ack('pong');
        }
      });

      if (config.NODE_ENV !== 'test') {
        console.log(`[Socket.IO] Client connected: socket=${socket.id}, user=${userId} (${user.username})`);
      }

      // 4. Handle Disconnect & In-memory Cleanup
      socket.on('disconnect', (reason) => {
        this.handleDisconnect(socket.id, userId, reason);
      });
    });

    return this.io;
  }

  /**
   * Cleans up socket tracking maps upon disconnection.
   */
  private handleDisconnect(socketId: string, userId: string, reason: string): void {
    const sockets = this.userSocketsMap.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.userSocketsMap.delete(userId);
      }
    }
    this.socketToUserMap.delete(socketId);

    if (config.NODE_ENV !== 'test') {
      console.log(`[Socket.IO] Client disconnected: socket=${socketId}, user=${userId} (reason: ${reason})`);
    }
  }

  /**
   * Retrieves the active Socket.IO server instance.
   */
  public getServer(): AppSocketServer | null {
    return this.io;
  }

  /**
   * Checks if a player currently has at least one active WebSocket connection.
   */
  public isUserConnected(userId: string): boolean {
    const sockets = this.userSocketsMap.get(userId);
    return Boolean(sockets && sockets.size > 0);
  }

  /**
   * Gets all active socket IDs for a given user ID.
   */
  public getUserSocketIds(userId: string): string[] {
    const sockets = this.userSocketsMap.get(userId);
    return sockets ? Array.from(sockets) : [];
  }

  /**
   * Returns the count of distinct authenticated users currently connected.
   */
  public getConnectedUsersCount(): number {
    return this.userSocketsMap.size;
  }

  /**
   * Clears internal state and closes the Socket.IO server.
   */
  public async close(): Promise<void> {
    if (this.io) {
      this.userSocketsMap.clear();
      this.socketToUserMap.clear();
      await new Promise<void>((resolve) => {
        this.io!.close(() => {
          this.io = null;
          resolve();
        });
      });
    }
  }
}

export const socketManager = new SocketManager();
export const initSocketServer = (
  httpServer: http.Server,
  options?: Partial<ServerOptions>
): AppSocketServer => socketManager.init(httpServer, options);
export const getSocketServer = (): AppSocketServer | null => socketManager.getServer();
export const closeSocketServer = (): Promise<void> => socketManager.close();

