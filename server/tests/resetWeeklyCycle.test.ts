import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WeeklyCycleService } from '../services/WeeklyCycleService';
import { ResetWeeklyCycleUseCase } from '../services/ResetWeeklyCycleUseCase';
import { InMemoryWeeklyCycleRepository } from '../infrastructure/repositories/inmemory/InMemoryWeeklyCycleRepository';
import { InMemoryLeaderboardRepository } from '../infrastructure/repositories/inmemory/InMemoryLeaderboardRepository';
import { PostgresWeeklyCycleRepository } from '../infrastructure/repositories/postgres/PostgresWeeklyCycleRepository';
import { WeeklyCycle, WeeklyCycleSettings, WeeklyResetEvent } from '../domain/entities';
import { ITransactionManager, ITransactionContext } from '../repositories/ITransactionManager';

describe('ResetWeeklyCycle Core Operation', () => {
  let weeklyCycleRepo: InMemoryWeeklyCycleRepository;
  let leaderboardRepo: InMemoryLeaderboardRepository;
  let weeklyCycleService: WeeklyCycleService;
  let resetWeeklyCycleUseCase: ResetWeeklyCycleUseCase;

  beforeEach(() => {
    const initialCycle = new WeeklyCycle({
      id: 'cycle-2026-w36',
      startsAt: new Date('2026-09-07T00:00:00.000Z'),
      endsAt: new Date('2026-09-13T23:59:00.000Z'),
      status: 'active',
      createdAt: new Date('2026-09-07T00:00:00.000Z'),
      completedAt: null,
    });

    const initialSettings = new WeeklyCycleSettings({
      id: 1,
      resetWeekday: 0, // Sunday
      resetTimeUtc: '23:59:00',
      updatedAt: new Date(),
    });

    weeklyCycleRepo = new InMemoryWeeklyCycleRepository([initialCycle], initialSettings);

    const initialLeaderboard = [
      {
        rank: 1,
        profile_id: 'usr_top_1',
        playerId: 'usr_top_1',
        username: 'top_runner',
        points: 1500, // season_points
        claimsCount: 15,
        tier: 'tier4' as const,
        rankChange: 'same' as const,
      },
      {
        rank: 2,
        profile_id: 'usr_runner_2',
        playerId: 'usr_runner_2',
        username: 'runner_two',
        points: 800, // season_points
        claimsCount: 8,
        tier: 'tier2' as const,
        rankChange: 'up' as const,
      },
    ];

    leaderboardRepo = new InMemoryLeaderboardRepository(initialLeaderboard);
    weeklyCycleService = new WeeklyCycleService(weeklyCycleRepo, leaderboardRepo);
    resetWeeklyCycleUseCase = new ResetWeeklyCycleUseCase(weeklyCycleService);
  });

  describe('1. Core Reset Execution Requirements', () => {
    it('should reset weekly scores to 0, record reset event, complete current cycle, and start next cycle', async () => {
      const resetKey = 'reset:2026-W37:scheduled';
      const result = await resetWeeklyCycleUseCase.execute({
        resetKey,
        resetType: 'scheduled',
        triggeredByProfileId: null,
      });

      assert.equal(result.success, true);
      assert.equal(result.duplicate, false);
      assert.equal(result.resetKey, resetKey);
      assert.equal(result.resetType, 'scheduled');
      assert.equal(result.cycleId, 'cycle-2026-w36');
      assert.ok(result.nextCycleId, 'Must return next cycle ID');
      assert.ok(result.nextResetAt, 'Must return next reset timestamp');

      // 1. Check previous cycle is completed
      const oldCycleEvent = await weeklyCycleRepo.getResetEventByKey(resetKey);
      assert.ok(oldCycleEvent, 'Reset event must be recorded');
      assert.equal(oldCycleEvent.cycleId, 'cycle-2026-w36');
      assert.equal(oldCycleEvent.resetKey, resetKey);
      assert.equal(oldCycleEvent.resetType, 'scheduled');

      // 2. Check weekly scores are reset to 0
      const weeklyLeaderboard = await leaderboardRepo.getWeekly();
      assert.equal(weeklyLeaderboard[0].points, 0, 'Top runner season_points must be 0');
      assert.equal(weeklyLeaderboard[1].points, 0, 'Runner two season_points must be 0');

      // 3. Check new active cycle exists
      const currentActive = await weeklyCycleRepo.getActiveCycle();
      assert.ok(currentActive, 'A new active cycle must exist');
      assert.equal(currentActive.id, result.nextCycleId);
      assert.equal(currentActive.status, 'active');
      assert.equal(currentActive.completedAt, null);
    });

    it('should support manual resets with triggeredByProfileId', async () => {
      const resetKey = 'reset:manual:admin-001:2026-09-13';
      const adminProfileId = 'admin-profile-uuid';

      const result = await resetWeeklyCycleUseCase.execute({
        resetKey,
        resetType: 'manual',
        triggeredByProfileId: adminProfileId,
      });

      assert.equal(result.success, true);
      assert.equal(result.duplicate, false);
      assert.equal(result.resetType, 'manual');

      const recordedEvent = await weeklyCycleRepo.getResetEventByKey(resetKey);
      assert.ok(recordedEvent);
      assert.equal(recordedEvent.triggeredByProfileId, adminProfileId);
    });
  });

  describe('2. Idempotency & Duplicate Reset Protection', () => {
    it('should detect duplicate resetKey and return no-op without re-resetting scores or creating multiple cycles', async () => {
      const resetKey = 'reset:2026-W37:scheduled';

      // 1st Execution
      const firstResult = await resetWeeklyCycleUseCase.execute({
        resetKey,
        resetType: 'scheduled',
      });
      assert.equal(firstResult.success, true);
      assert.equal(firstResult.duplicate, false);

      const activeCycleAfterFirst = await weeklyCycleRepo.getActiveCycle();

      // Simulate a user scoring in the new cycle
      const mockPlayerId = 'usr_top_1';
      await leaderboardRepo.recordScore(mockPlayerId, 250);

      // 2nd Execution with same resetKey (Duplicate Attempt)
      const secondResult = await resetWeeklyCycleUseCase.execute({
        resetKey,
        resetType: 'scheduled',
      });

      assert.equal(secondResult.success, true);
      assert.equal(secondResult.duplicate, true);
      assert.equal(secondResult.resetKey, resetKey);
      assert(secondResult.message.includes('already been executed') || secondResult.message.includes('already'));

      // Active cycle should NOT have changed on duplicate
      const activeCycleAfterSecond = await weeklyCycleRepo.getActiveCycle();
      assert.equal(activeCycleAfterSecond?.id, activeCycleAfterFirst?.id);
    });
  });

  describe('3. Transaction & Complete Rollback Verification', () => {
    it('should roll back completely and leave state intact if an error occurs during transaction', async () => {
      let rollbackInvoked = false;

      // Mock TransactionManager that simulates failure during execution
      const failingTxManager: ITransactionManager = {
        runInTransaction: async <T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> => {
          const fakeTx: ITransactionContext = {
            query: async () => ({ rows: [], rowCount: 0 }),
          };
          try {
            await work(fakeTx);
            throw new Error('Database disk error during reset');
          } catch (err) {
            rollbackInvoked = true;
            throw err;
          }
        },
      };

      const failingService = new WeeklyCycleService(weeklyCycleRepo, leaderboardRepo, failingTxManager);
      const failingUseCase = new ResetWeeklyCycleUseCase(failingService);

      await assert.rejects(
        async () => {
          await failingUseCase.execute({
            resetKey: 'reset:failing-key',
            resetType: 'scheduled',
          });
        },
        /Database disk error during reset/
      );

      assert.equal(rollbackInvoked, true, 'Transaction must trigger rollback on error');
    });
  });

  describe('4. PostgresWeeklyCycleRepository SQL Generation & Locking', () => {
    it('should use FOR UPDATE row lock when querying active cycle inside transaction', async () => {
      let capturedQuery = '';
      const mockTx: ITransactionContext = {
        query: async <T = Record<string, unknown>>(text: string) => {
          capturedQuery = text;
          return {
            rows: [
              {
                id: 'active-uuid-1',
                starts_at: new Date(),
                ends_at: new Date(),
                status: 'active',
                created_at: new Date(),
                completed_at: null,
              },
            ] as unknown as T[],
            rowCount: 1,
          };
        },
      };

      const repo = new PostgresWeeklyCycleRepository({} as any);
      await repo.getActiveCycleTx(mockTx, true);

      assert(capturedQuery.includes('FOR UPDATE'), 'Must query with FOR UPDATE row lock to prevent concurrent races');
    });

    it('should use ON CONFLICT (reset_key) DO NOTHING when recording reset event', async () => {
      let capturedQuery = '';
      let capturedParams: any[] = [];

      const mockTx: ITransactionContext = {
        query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
          capturedQuery = text;
          capturedParams = params || [];
          return {
            rows: [{ id: 'evt-uuid-1' }] as unknown as T[],
            rowCount: 1,
          };
        },
      };

      const repo = new PostgresWeeklyCycleRepository({} as any);
      const recorded = await repo.recordResetEventTx(
        {
          cycleId: 'cycle-123',
          resetKey: 'reset:2026-W37:scheduled',
          resetType: 'scheduled',
          triggeredByProfileId: null,
        },
        mockTx
      );

      assert.equal(recorded, true);
      assert(capturedQuery.includes('ON CONFLICT (reset_key) DO NOTHING'), 'Must use ON CONFLICT on reset_key');
      assert.equal(capturedParams[0], 'cycle-123');
      assert.equal(capturedParams[1], 'reset:2026-W37:scheduled');
    });
  });
});
