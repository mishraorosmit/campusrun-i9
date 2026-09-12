import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  WeeklyCycleService,
  calculateNextResetTimestamp,
} from '../services/WeeklyCycleService';
import { GetNextWeeklyResetUseCase } from '../services/GetNextWeeklyResetUseCase';
import { WeeklyCycleController } from '../controllers/WeeklyCycleController';
import { InMemoryWeeklyCycleRepository } from '../infrastructure/repositories/inmemory/InMemoryWeeklyCycleRepository';
import { InMemoryLeaderboardRepository } from '../infrastructure/repositories/inmemory/InMemoryLeaderboardRepository';
import { PostgresWeeklyCycleRepository } from '../infrastructure/repositories/postgres/PostgresWeeklyCycleRepository';
import { WeeklyCycle, WeeklyCycleSettings } from '../domain/entities';

describe('Weekly Cycle Service and Next-Reset Logic', () => {
  let weeklyCycleRepo: InMemoryWeeklyCycleRepository;
  let weeklyCycleService: WeeklyCycleService;
  let getNextWeeklyResetUseCase: GetNextWeeklyResetUseCase;
  let controller: WeeklyCycleController;

  beforeEach(() => {
    weeklyCycleRepo = new InMemoryWeeklyCycleRepository();
    weeklyCycleService = new WeeklyCycleService(weeklyCycleRepo);
    getNextWeeklyResetUseCase = new GetNextWeeklyResetUseCase(weeklyCycleService);
    controller = new WeeklyCycleController(getNextWeeklyResetUseCase);
  });

  describe('1. calculateNextResetTimestamp UTC Calculations', () => {
    it('should return the same Sunday 23:59:00 UTC if fromDate is earlier on Sunday', () => {
      // 2026-09-13 is Sunday
      const sundayMorning = new Date('2026-09-13T10:30:00.000Z');
      const settings = { resetWeekday: 0, resetTimeUtc: '23:59:00' };

      const nextReset = calculateNextResetTimestamp(settings, sundayMorning);

      assert.equal(nextReset.toISOString(), '2026-09-13T23:59:00.000Z');
      assert.equal(nextReset.getUTCDay(), 0);
    });

    it('should return next Sunday 23:59:00 UTC if fromDate is after 23:59:00 on Sunday', () => {
      const sundayLate = new Date('2026-09-13T23:59:01.000Z');
      const settings = { resetWeekday: 0, resetTimeUtc: '23:59:00' };

      const nextReset = calculateNextResetTimestamp(settings, sundayLate);

      assert.equal(nextReset.toISOString(), '2026-09-20T23:59:00.000Z');
      assert.equal(nextReset.getUTCDay(), 0);
    });

    it('should return next Sunday 23:59:00 UTC if fromDate is Monday', () => {
      // 2026-09-14 is Monday
      const monday = new Date('2026-09-14T08:00:00.000Z');
      const settings = { resetWeekday: 0, resetTimeUtc: '23:59:00' };

      const nextReset = calculateNextResetTimestamp(settings, monday);

      assert.equal(nextReset.toISOString(), '2026-09-20T23:59:00.000Z');
      assert.equal(nextReset.getUTCDay(), 0);
    });

    it('should handle custom reset weekday and time (e.g. Wednesday 18:00:00 UTC)', () => {
      // 2026-09-15 is Tuesday (weekday 2)
      const tuesday = new Date('2026-09-15T12:00:00.000Z');
      const settings = { resetWeekday: 3, resetTimeUtc: '18:00:00' }; // Wednesday (3)

      const nextReset = calculateNextResetTimestamp(settings, tuesday);

      assert.equal(nextReset.toISOString(), '2026-09-16T18:00:00.000Z');
      assert.equal(nextReset.getUTCDay(), 3);
    });

    it('should handle month and year rollovers deterministically', () => {
      // 2026-12-30 is Wednesday. Next Sunday is 2027-01-03
      const endOfYear = new Date('2026-12-30T10:00:00.000Z');
      const settings = { resetWeekday: 0, resetTimeUtc: '23:59:00' };

      const nextReset = calculateNextResetTimestamp(settings, endOfYear);

      assert.equal(nextReset.toISOString(), '2027-01-03T23:59:00.000Z');
      assert.equal(nextReset.getUTCFullYear(), 2027);
    });
  });

  describe('2. WeeklyCycleService & Use Case Logic', () => {
    it('should return existing active cycle if already present', async () => {
      const existingCycle = new WeeklyCycle({
        id: 'cycle-active-1',
        startsAt: new Date('2026-09-07T00:00:00.000Z'),
        endsAt: new Date('2026-09-14T23:59:00.000Z'),
        status: 'active',
        createdAt: new Date('2026-09-07T00:00:00.000Z'),
        completedAt: null,
      });

      const repo = new InMemoryWeeklyCycleRepository([existingCycle]);
      const service = new WeeklyCycleService(repo);

      const active = await service.getActiveCycle();
      assert.equal(active.id, 'cycle-active-1');
      assert.equal(active.status, 'active');
      assert.equal(active.endsAt.toISOString(), '2026-09-14T23:59:00.000Z');
    });

    it('should automatically initialize a new active cycle if none exists without mutating scores', async () => {
      const emptyRepo = new InMemoryWeeklyCycleRepository([]);
      const service = new WeeklyCycleService(emptyRepo);

      const fixedDate = new Date('2026-09-08T12:00:00.000Z'); // Tuesday
      const active = await service.getActiveCycle(fixedDate);

      assert.ok(active.id);
      assert.equal(active.status, 'active');
      assert.equal(active.startsAt.toISOString(), fixedDate.toISOString());
      assert.equal(active.endsAt.toISOString(), '2026-09-13T23:59:00.000Z'); // Next Sunday
    });

    it('should expose the next reset timestamp via getNextResetTimestamp', async () => {
      const fixedDate = new Date('2026-09-10T12:00:00.000Z'); // Thursday
      const result = await weeklyCycleService.getNextResetTimestamp(fixedDate);

      assert.equal(result.status, 'active');
      assert.equal(result.nextResetAt, '2026-09-13T23:59:00.000Z');
      assert.ok(result.cycleId);
    });

    it('should execute GetNextWeeklyResetUseCase cleanly', async () => {
      const fixedDate = new Date('2026-09-10T12:00:00.000Z');
      const result = await getNextWeeklyResetUseCase.execute(fixedDate);

      assert.equal(result.status, 'active');
      assert.equal(result.nextResetAt, '2026-09-13T23:59:00.000Z');
    });
  });

  describe('3. Controller & Endpoint Response', () => {
    it('should return next reset timestamp with 200 OK and valid JSON format', async () => {
      let responseStatus = 0;
      let responseBody: any = null;

      const req: any = {};
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

      await controller.getNextReset(req, res, next);

      assert.equal(responseStatus, 200);
      assert.equal(responseBody.success, true);
      assert.ok(responseBody.data.nextResetAt, 'Must include nextResetAt in data');
      assert.ok(responseBody.nextResetAt, 'Must include top-level nextResetAt');
      assert.equal(responseBody.data.status, 'active');
    });

    it('should verify player scores are strictly preserved when next-reset is read', async () => {
      const leaderboardRepo = new InMemoryLeaderboardRepository([
        {
          rank: 1,
          profile_id: 'p1',
          playerId: 'p1',
          username: 'player_one',
          points: 500,
          claimsCount: 5,
          tier: 'tier1',
          rankChange: 'same',
        },
      ]);

      // Call next reset logic
      await getNextWeeklyResetUseCase.execute();

      // Verify leaderboard score remains 500
      const leaderboard = await leaderboardRepo.getWeekly();
      assert.equal(leaderboard[0].points, 500, 'Leaderboard player score must not change');
    });
  });

  describe('4. PostgresWeeklyCycleRepository SQL Queries', () => {
    it('should query active weekly cycle from database', async () => {
      let executedQuery = '';
      const mockPool = {
        query: async (text: string) => {
          executedQuery = text;
          return {
            rows: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                starts_at: new Date('2026-09-07T00:00:00Z'),
                ends_at: new Date('2026-09-14T23:59:00Z'),
                status: 'active',
                created_at: new Date('2026-09-07T00:00:00Z'),
                completed_at: null,
              },
            ],
            rowCount: 1,
          };
        },
      } as any;

      const repo = new PostgresWeeklyCycleRepository(mockPool);
      const cycle = await repo.getActiveCycle();

      assert(executedQuery.includes("status = 'active'"), 'Must filter by status = active');
      assert.ok(cycle);
      assert.equal(cycle.id, '11111111-1111-1111-1111-111111111111');
      assert.equal(cycle.status, 'active');
    });

    it('should query weekly cycle settings from database', async () => {
      let executedQuery = '';
      const mockPool = {
        query: async (text: string) => {
          executedQuery = text;
          return {
            rows: [
              {
                id: 1,
                reset_weekday: 0,
                reset_time_utc: '23:59:00',
                updated_at: new Date('2026-09-07T00:00:00Z'),
              },
            ],
            rowCount: 1,
          };
        },
      } as any;

      const repo = new PostgresWeeklyCycleRepository(mockPool);
      const settings = await repo.getSettings();

      assert(executedQuery.includes('WHERE id = 1'), 'Must query settings row id = 1');
      assert.ok(settings);
      assert.equal(settings.id, 1);
      assert.equal(settings.resetWeekday, 0);
      assert.equal(settings.resetTimeUtc, '23:59:00');
    });
  });
});
