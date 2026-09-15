import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../controllers/PlayerController';
import { GetPlayerProfileUseCase } from '../services/GetPlayerProfileUseCase';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { Player } from '../domain/entities/Player';
import { requireCurrentUser, requireAuthenticatedUser } from '../middlewares/auth';
import { JwtUtils } from '../infrastructure/auth/JwtUtils';
import { config } from '../config';

describe('GET /api/v1/me and Current User Profile Endpoint', () => {
  let playerRepo: InMemoryPlayerRepository;
  let getPlayerProfileUseCase: GetPlayerProfileUseCase;
  let playerController: PlayerController;

  const testPlayer = new Player({
    id: 'user-me-uuid-1',
    email: 'student1@campus.edu',
    username: 'campus_runner',
    displayName: 'Campus Legend',
    avatarUrl: 'https://campus.edu/avatars/runner.png',
    status: 'active',
    totalPoints: 1250,
    seasonPoints: 450,
    rank: 3,
    tier: 'tier2',
    claimsCount: 15,
    currentStreakDays: 5,
    campusZone: 'north_campus',
    role: 'STUDENT',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    lastActiveAt: new Date('2026-09-13T00:00:00.000Z'),
  });

  const testPlayerNoDisplayName = new Player({
    id: 'user-me-uuid-2',
    email: 'student2@campus.edu',
    username: 'speedy_runner',
    displayName: undefined,
    avatarUrl: undefined,
    status: 'active',
    totalPoints: 800,
    seasonPoints: 200,
    rank: 12,
    tier: 'tier1',
    claimsCount: 8,
    currentStreakDays: 2,
    campusZone: 'south_campus',
    role: 'STUDENT',
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    lastActiveAt: new Date('2026-09-13T00:00:00.000Z'),
  });

  beforeEach(() => {
    playerRepo = new InMemoryPlayerRepository([testPlayer, testPlayerNoDisplayName]);
    getPlayerProfileUseCase = new GetPlayerProfileUseCase(playerRepo);
    playerController = new PlayerController(getPlayerProfileUseCase);
  });

  describe('1. Current-User Authentication Middleware Guard', () => {
    it('should reject unauthenticated request with 401 Unauthorized if Authorization header is missing', () => {
      const req: any = { headers: {} };
      const res: any = {};
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should reject unauthenticated request with 401 Unauthorized if token is malformed', () => {
      const req: any = { headers: { authorization: 'Bearer invalid.token.payload' } };
      const res: any = {};
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should attach user payload to req.user and pass middleware when valid token is present', () => {
      const token = JwtUtils.sign(
        {
          sub: testPlayer.id,
          email: testPlayer.props.email,
          username: testPlayer.username,
          role: testPlayer.role,
        },
        config.JWT_SECRET,
        3600
      );

      const req: any = { headers: { authorization: `Bearer ${token}` } };
      const res: any = {};
      let nextCalled = false;
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        nextCalled = true;
        errReceived = err;
      });

      assert.equal(nextCalled, true);
      assert.equal(errReceived, undefined);
      assert.equal(req.user.id, testPlayer.id);
      assert.equal(req.user.email, testPlayer.props.email);
      assert.equal(req.user.username, testPlayer.username);
    });
  });

  describe('2. PlayerController.getMyProfile Endpoint Handler', () => {
    it('should return safe profile fields for the authenticated user', async () => {
      const req: any = {
        user: {
          id: testPlayer.id,
          email: testPlayer.props.email,
          username: testPlayer.username,
          role: testPlayer.role,
        },
      };

      let responseStatusCode = 200;
      let responseBody: any = null;

      const res: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      let nextErr: any = null;
      await playerController.getMyProfile(req, res, (err) => {
        nextErr = err;
      });

      assert.equal(nextErr, null);
      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.ok(responseBody.data);

      const data = responseBody.data;
      // Expected safe fields
      assert.equal(data.id, testPlayer.id);
      assert.equal(data.email, testPlayer.props.email);
      assert.equal(data.username, testPlayer.username);
      assert.equal(data.displayName, 'Campus Legend');
      assert.equal(data.avatarUrl, 'https://campus.edu/avatars/runner.png');
      assert.equal(data.totalPoints, 1250);
      assert.equal(data.seasonPoints, 450);
      assert.equal(data.rank, 3);
      assert.equal(data.tier, 'tier2');
      assert.equal(data.claimsCount, 15);
      assert.equal(data.currentStreakDays, 5);
      assert.equal(data.role, 'STUDENT');

      // Ensure NO sensitive or secret fields exist
      assert.equal(data.password, undefined);
      assert.equal(data.password_hash, undefined);
      assert.equal(data.accessToken, undefined);
      assert.equal(data.refreshToken, undefined);
      assert.equal(data.secret, undefined);
    });

    it('should fallback displayName to username when displayName is absent', async () => {
      const req: any = {
        user: {
          id: testPlayerNoDisplayName.id,
          email: testPlayerNoDisplayName.props.email,
          username: testPlayerNoDisplayName.username,
          role: testPlayerNoDisplayName.role,
        },
      };

      let responseBody: any = null;
      const res: any = {
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await playerController.getMyProfile(req, res, (err) => {
        assert.fail(`Next should not be called with error: ${err}`);
      });

      assert.equal(responseBody.success, true);
      assert.equal(responseBody.data.displayName, 'speedy_runner');
      assert.equal(responseBody.data.username, 'speedy_runner');
    });

    it('should return 401 if req.user is absent when controller is invoked', async () => {
      const req: any = {};
      const res: any = { json() {} };
      let errReceived: any = null;

      await playerController.getMyProfile(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });
  });
});
