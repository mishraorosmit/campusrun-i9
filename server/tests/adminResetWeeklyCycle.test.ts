import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AdminController } from '../controllers/AdminController';
import { ResetWeeklyCycleUseCase } from '../services/ResetWeeklyCycleUseCase';
import { WeeklyCycleService } from '../services/WeeklyCycleService';
import { InMemoryWeeklyCycleRepository } from '../infrastructure/repositories/inmemory/InMemoryWeeklyCycleRepository';
import { InMemoryLeaderboardRepository } from '../infrastructure/repositories/inmemory/InMemoryLeaderboardRepository';
import { WeeklyCycle, WeeklyCycleSettings } from '../domain/entities';
import { createAdminAuthMiddleware } from '../middlewares/auth';
import { JwtUtils } from '../infrastructure/auth/JwtUtils';

describe('Admin Manual Weekly Reset Endpoint & Authorization', () => {
  let weeklyCycleRepo: InMemoryWeeklyCycleRepository;
  let leaderboardRepo: InMemoryLeaderboardRepository;
  let weeklyCycleService: WeeklyCycleService;
  let resetWeeklyCycleUseCase: ResetWeeklyCycleUseCase;
  let adminController: AdminController;

  const jwtSecret = 'test-admin-secret-key-12345';

  beforeEach(() => {
    const initialCycle = new WeeklyCycle({
      id: 'cycle-manual-001',
      startsAt: new Date('2026-09-07T00:00:00.000Z'),
      endsAt: new Date('2026-09-14T23:59:00.000Z'),
      status: 'active',
      createdAt: new Date('2026-09-07T00:00:00.000Z'),
      completedAt: null,
    });

    const initialSettings = new WeeklyCycleSettings({
      id: 1,
      resetWeekday: 0,
      resetTimeUtc: '23:59:00',
      updatedAt: new Date(),
    });

    weeklyCycleRepo = new InMemoryWeeklyCycleRepository([initialCycle], initialSettings);

    const initialLeaderboard = [
      {
        rank: 1,
        profile_id: 'player_one',
        playerId: 'player_one',
        username: 'runner_1',
        points: 900,
        claimsCount: 9,
        tier: 'tier3' as const,
        rankChange: 'same' as const,
      },
    ];

    leaderboardRepo = new InMemoryLeaderboardRepository(initialLeaderboard);
    weeklyCycleService = new WeeklyCycleService(weeklyCycleRepo, leaderboardRepo);
    resetWeeklyCycleUseCase = new ResetWeeklyCycleUseCase(weeklyCycleService);

    adminController = new AdminController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      resetWeeklyCycleUseCase,
      weeklyCycleRepo
    );
  });

  describe('1. Manual Weekly Reset Handler Execution', () => {
    it('should trigger manual reset with deterministic resetKey `manual:<active_cycle_id>` and reset scores to 0', async () => {
      let responseStatus = 0;
      let responseBody: any = null;

      const req: any = {
        user: {
          id: 'admin-user-uuid',
          email: 'admin@campusrun.edu',
          username: 'admin_boss',
          role: 'admin',
        },
        body: {},
      };

      const res: any = {
        status(code: number) {
          responseStatus = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
        },
      };

      const next = (err: any) => {
        throw err;
      };

      await adminController.resetWeeklyCycle(req, res, next);

      assert.equal(responseStatus, 200);
      assert.equal(responseBody.success, true);
      assert.equal(responseBody.data.resetKey, 'manual:cycle-manual-001');
      assert.equal(responseBody.data.resetType, 'manual');
      assert.equal(responseBody.data.duplicate, false);

      // Verify weekly scores reset to 0
      const leaderboard = await leaderboardRepo.getWeekly();
      assert.equal(leaderboard[0].points, 0);

      // Verify reset event record
      const recorded = await weeklyCycleRepo.getResetEventByKey('manual:cycle-manual-001');
      assert.ok(recorded);
      assert.equal(recorded.resetType, 'manual');
      assert.equal(recorded.triggeredByProfileId, 'admin-user-uuid');
    });

    it('should return duplicate: true on repeated manual reset attempt for same cycle', async () => {
      let responseStatus = 0;
      let responseBody: any = null;

      const req: any = {
        user: { id: 'admin-1', role: 'admin' },
        body: {},
      };
      const res: any = {
        status(code: number) {
          responseStatus = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
        },
      };
      const next = (err: any) => {
        throw err;
      };

      // First call (successful reset)
      await adminController.resetWeeklyCycle(req, res, next);
      assert.equal(responseBody.data.duplicate, false);

      // Explicit second call with same manual reset key
      const req2: any = {
        user: { id: 'admin-1', role: 'admin' },
        body: { resetKey: 'manual:cycle-manual-001' },
      };
      await adminController.resetWeeklyCycle(req2, res, next);

      assert.equal(responseStatus, 200);
      assert.equal(responseBody.success, true);
      assert.equal(responseBody.data.duplicate, true);
      assert.equal(responseBody.data.resetKey, 'manual:cycle-manual-001');
    });
  });

  describe('2. Admin Authorization Middleware', () => {
    const adminAuth = createAdminAuthMiddleware(jwtSecret);

    it('should allow access for users with role = "admin"', () => {
      const token = JwtUtils.sign(
        { sub: 'usr-admin', email: 'admin@campus.edu', username: 'admin', role: 'admin' },
        jwtSecret,
        3600
      );

      const req: any = {
        headers: { authorization: `Bearer ${token}` },
      };
      const res: any = {};
      let nextCalled = false;
      let nextError: any = null;

      adminAuth(req, res, (err) => {
        nextCalled = true;
        nextError = err;
      });

      assert.equal(nextCalled, true);
      assert.equal(nextError, undefined);
      assert.equal(req.user.role, 'admin');
    });

    it('should allow access for users with role = "superadmin"', () => {
      const token = JwtUtils.sign(
        { sub: 'usr-super', email: 'super@campus.edu', username: 'superadmin', role: 'superadmin' },
        jwtSecret,
        3600
      );

      const req: any = {
        headers: { authorization: `Bearer ${token}` },
      };
      const res: any = {};
      let nextCalled = false;
      let nextError: any = null;

      adminAuth(req, res, (err) => {
        nextCalled = true;
        nextError = err;
      });

      assert.equal(nextCalled, true);
      assert.equal(nextError, undefined);
      assert.equal(req.user.role, 'superadmin');
    });

    it('should reject non-admin users (role = "player") with 403 ForbiddenError', () => {
      const token = JwtUtils.sign(
        { sub: 'usr-player', email: 'player@campus.edu', username: 'player1', role: 'player' },
        jwtSecret,
        3600
      );

      const req: any = {
        headers: { authorization: `Bearer ${token}` },
      };
      const res: any = {};
      let nextError: any = null;

      adminAuth(req, res, (err) => {
        nextError = err;
      });

      assert.ok(nextError);
      assert.equal(nextError.statusCode, 403);
      assert(nextError.message.includes('Admin privileges required'));
    });

    it('should reject unauthenticated requests with 401 UnauthorizedError', () => {
      const req: any = { headers: {} };
      const res: any = {};
      let nextError: any = null;

      adminAuth(req, res, (err) => {
        nextError = err;
      });

      assert.ok(nextError);
      assert.equal(nextError.statusCode, 401);
    });
  });
});
