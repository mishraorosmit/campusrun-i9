import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app';
import { initSocketServer, closeSocketServer, socketManager } from '../realtime';
import { JwtUtils } from '../infrastructure/auth/JwtUtils';
import { config } from '../config';

describe('Socket.IO Server Setup & Connection Authentication', () => {
  let httpServer: http.Server;
  let serverPort: number;
  let serverUrl: string;

  const validStudentToken = JwtUtils.sign(
    {
      sub: 'player_ws_001',
      email: 'alex@campus.edu',
      username: 'alex_runner',
      role: 'STUDENT',
    },
    config.JWT_SECRET,
    3600
  );

  const validAdminToken = JwtUtils.sign(
    {
      sub: 'admin_ws_002',
      email: 'admin@campus.edu',
      username: 'campus_admin',
      role: 'ADMIN',
    },
    config.JWT_SECRET,
    3600
  );

  const expiredToken = JwtUtils.sign(
    {
      sub: 'player_ws_003',
      email: 'expired@campus.edu',
      username: 'expired_user',
      role: 'STUDENT',
    },
    config.JWT_SECRET,
    -10
  );

  before(async () => {
    const app = createApp();
    httpServer = http.createServer(app);
    initSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address() as AddressInfo;
        serverPort = addr.port;
        serverUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  after(async () => {
    await closeSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('should reject unauthenticated connection attempts (missing token)', async () => {
    await new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioClient(serverUrl, {
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect', () => {
        client.disconnect();
        reject(new Error('Unauthenticated connection should have been rejected'));
      });

      client.on('connect_error', (err) => {
        assert.match(err.message, /Authentication required/);
        client.disconnect();
        resolve();
      });
    });
  });

  it('should reject connections with an expired JWT token', async () => {
    await new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioClient(serverUrl, {
        auth: { token: expiredToken },
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect', () => {
        client.disconnect();
        reject(new Error('Expired token connection should have been rejected'));
      });

      client.on('connect_error', (err) => {
        assert.match(err.message, /expired/i);
        client.disconnect();
        resolve();
      });
    });
  });

  it('should reject connections with an invalid token signature', async () => {
    const tamperedToken = validStudentToken.slice(0, -5) + 'zzzzz';

    await new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioClient(serverUrl, {
        auth: { token: tamperedToken },
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect', () => {
        client.disconnect();
        reject(new Error('Tampered token connection should have been rejected'));
      });

      client.on('connect_error', (err) => {
        assert.match(err.message, /Invalid access token/i);
        client.disconnect();
        resolve();
      });
    });
  });

  it('should successfully authenticate via handshake auth.token and attach socket.data', async () => {
    await new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioClient(serverUrl, {
        auth: { token: validStudentToken },
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect', () => {
        try {
          assert.equal(socketManager.isUserConnected('player_ws_001'), true);
          assert.ok(socketManager.getUserSocketIds('player_ws_001').length >= 1);
          assert.ok(socketManager.getConnectedUsersCount() >= 1);

          client.disconnect();
          resolve();
        } catch (e) {
          client.disconnect();
          reject(e);
        }
      });

      client.on('connect_error', (err) => {
        reject(err);
      });
    });
  });

  it('should successfully authenticate via Authorization header', async () => {
    await new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioClient(serverUrl, {
        extraHeaders: {
          authorization: `Bearer ${validAdminToken}`,
        },
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect', () => {
        try {
          assert.equal(socketManager.isUserConnected('admin_ws_002'), true);
          client.disconnect();
          resolve();
        } catch (e) {
          client.disconnect();
          reject(e);
        }
      });

      client.on('connect_error', (err) => {
        reject(err);
      });
    });
  });

  it('should clean up in-memory tracking on disconnect', async () => {
    const testUserId = 'player_ws_001';

    await new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioClient(serverUrl, {
        auth: { token: validStudentToken },
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect', () => {
        assert.equal(socketManager.isUserConnected(testUserId), true);

        // Disconnect client
        client.disconnect();

        // Allow microtask / event queue to process server disconnect handler
        setTimeout(() => {
          try {
            assert.equal(socketManager.isUserConnected(testUserId), false);
            assert.deepEqual(socketManager.getUserSocketIds(testUserId), []);
            resolve();
          } catch (e) {
            reject(e);
          }
        }, 50);
      });

      client.on('connect_error', (err) => {
        reject(err);
      });
    });
  });

  it('should automatically join campus_global and user:<userId> rooms upon connection', async () => {
    const ioServer = socketManager.getServer();
    assert.ok(ioServer);

    await new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioClient(serverUrl, {
        auth: { token: validStudentToken },
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect', () => {
        try {
          const socketId = client.id;
          assert.ok(socketId);
          const serverSocket = ioServer!.sockets.sockets.get(socketId!);
          assert.ok(serverSocket);

          // Verify rooms
          assert.equal(serverSocket.rooms.has('campus_global'), true);
          assert.equal(serverSocket.rooms.has('user:player_ws_001'), true);
          assert.equal(serverSocket.rooms.has('admin'), false); // Not an admin

          client.disconnect();
          resolve();
        } catch (e) {
          client.disconnect();
          reject(e);
        }
      });

      client.on('connect_error', (err) => {
        reject(err);
      });
    });
  });

  it('should automatically join admin room if connected user is an admin', async () => {
    const ioServer = socketManager.getServer();
    assert.ok(ioServer);

    await new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioClient(serverUrl, {
        auth: { token: validAdminToken },
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect', () => {
        try {
          const socketId = client.id;
          assert.ok(socketId);
          const serverSocket = ioServer!.sockets.sockets.get(socketId!);
          assert.ok(serverSocket);

          assert.equal(serverSocket.rooms.has('campus_global'), true);
          assert.equal(serverSocket.rooms.has('user:admin_ws_002'), true);
          assert.equal(serverSocket.rooms.has('admin'), true);

          client.disconnect();
          resolve();
        } catch (e) {
          client.disconnect();
          reject(e);
        }
      });

      client.on('connect_error', (err) => {
        reject(err);
      });
    });
  });

  it('should NOT emit full-state dump events on initial connection', async () => {
    await new Promise<void>((resolve, reject) => {
      let receivedAnyEvent = false;

      const client: ClientSocket = ioClient(serverUrl, {
        auth: { token: validStudentToken },
        transports: ['websocket'],
        reconnection: false,
      });

      client.onAny((event) => {
        if (event === 'reconnect:sync_required') {
          return; // Lightweight reconnect signal is permitted and expected
        }
        receivedAnyEvent = true;
        reject(new Error(`Unexpected event "${event}" emitted on initial connection`));
      });

      client.on('connect', () => {
        setTimeout(() => {
          assert.equal(receivedAnyEvent, false);
          client.disconnect();
          resolve();
        }, 80);
      });

      client.on('connect_error', (err) => {
        reject(err);
      });
    });
  });

  it('should support dynamic zone room join and leave events with acknowledgements', async () => {
    const ioServer = socketManager.getServer();
    assert.ok(ioServer);

    await new Promise<void>((resolve, reject) => {
      const client: ClientSocket = ioClient(serverUrl, {
        auth: { token: validStudentToken },
        transports: ['websocket'],
        reconnection: false,
      });

      client.on('connect', () => {
        const socketId = client.id!;
        const serverSocket = ioServer!.sockets.sockets.get(socketId)!;

        // Join zone
        client.emit('room:join_zone', 'north_quad', (res1: any) => {
          try {
            assert.equal(res1.success, true);
            assert.equal(res1.room, 'zone:north_quad');
            assert.equal(serverSocket.rooms.has('zone:north_quad'), true);

            // Leave zone
            client.emit('room:leave_zone', 'north_quad', (res2: any) => {
              try {
                assert.equal(res2.success, true);
                assert.equal(serverSocket.rooms.has('zone:north_quad'), false);

                // Ping test
                client.emit('ping', (pong: string) => {
                  try {
                    assert.equal(pong, 'pong');
                    client.disconnect();
                    resolve();
                  } catch (e) {
                    client.disconnect();
                    reject(e);
                  }
                });
              } catch (e) {
                client.disconnect();
                reject(e);
              }
            });
          } catch (e) {
            client.disconnect();
            reject(e);
          }
        });
      });

      client.on('connect_error', (err) => {
        reject(err);
      });
    });
  });

  it('should verify Express HTTP routes continue operating alongside Socket.IO', async () => {
    const res = await fetch(`${serverUrl}/api/health`);
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.status, 'ok');
  });
});
