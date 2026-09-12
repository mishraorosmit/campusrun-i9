import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WeeklyResetScheduler } from '../services/WeeklyResetScheduler';
import { ResetWeeklyCycleUseCase } from '../services/ResetWeeklyCycleUseCase';
import { WeeklyCycleService } from '../services/WeeklyCycleService';
import { InMemoryWeeklyCycleRepository } from '../infrastructure/repositories/inmemory/InMemoryWeeklyCycleRepository';
import { InMemoryLeaderboardRepository } from '../infrastructure/repositories/inmemory/InMemoryLeaderboardRepository';
import { WeeklyCycle, WeeklyCycleSettings } from '../domain/entities';

describe('WeeklyResetScheduler Trigger & Automation', () => {
  let weeklyCycleRepo: InMemoryWeeklyCycleRepository;
  let leaderboardRepo: InMemoryLeaderboardRepository;
  let weeklyCycleService: WeeklyCycleService;
  let resetWeeklyCycleUseCase: ResetWeeklyCycleUseCase;
  let scheduler: WeeklyResetScheduler;

  const cycleEndsAt = new Date('2026-09-13T23:59:00.000Z');

  beforeEach(() => {
    const initialCycle = new WeeklyCycle({
      id: 'cycle-w36-1234',
      startsAt: new Date('2026-09-07T00:00:00.000Z'),
      endsAt: cycleEndsAt,
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
        profile_id: 'player-alpha',
        playerId: 'player-alpha',
        username: 'alpha_runner',
        points: 750, // season points
        claimsCount: 8,
        tier: 'tier2' as const,
        rankChange: 'same' as const,
      },
    ];

    leaderboardRepo = new InMemoryLeaderboardRepository(initialLeaderboard);
    weeklyCycleService = new WeeklyCycleService(weeklyCycleRepo, leaderboardRepo);
    resetWeeklyCycleUseCase = new ResetWeeklyCycleUseCase(weeklyCycleService);

    scheduler = new WeeklyResetScheduler(weeklyCycleRepo, resetWeeklyCycleUseCase, {
      checkIntervalMs: 5000,
      autoStart: false,
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('1. Due-Time Validation', () => {
    it('should NOT execute reset when current time is strictly before ends_at', async () => {
      // 10 minutes before reset
      const beforeTime = new Date('2026-09-13T23:49:00.000Z');

      const check = await scheduler.checkAndExecuteReset(beforeTime);

      assert.equal(check.checked, true);
      assert.equal(check.executed, false);
      assert(check.reason?.includes('not due yet'));

      // Scores must remain intact
      const leaderboard = await leaderboardRepo.getWeekly();
      assert.equal(leaderboard[0].points, 750);

      // Active cycle must still be the original one
      const activeCycle = await weeklyCycleRepo.getActiveCycle();
      assert.equal(activeCycle?.id, 'cycle-w36-1234');
      assert.equal(activeCycle?.status, 'active');
    });

    it('should execute reset when current time is equal to ends_at', async () => {
      const exactTime = new Date('2026-09-13T23:59:00.000Z');

      const check = await scheduler.checkAndExecuteReset(exactTime);

      assert.equal(check.checked, true);
      assert.equal(check.executed, true);
      assert.equal(check.result?.resetKey, 'scheduled:cycle-w36-1234');
      assert.equal(check.result?.resetType, 'scheduled');
      assert.equal(check.result?.duplicate, false);

      // Scores must now be reset to 0
      const leaderboard = await leaderboardRepo.getWeekly();
      assert.equal(leaderboard[0].points, 0);

      // A new active cycle must be running
      const activeCycle = await weeklyCycleRepo.getActiveCycle();
      assert.notEqual(activeCycle?.id, 'cycle-w36-1234');
      assert.equal(activeCycle?.status, 'active');
    });

    it('should execute reset when current time has passed ends_at (catch-up / overdue)', async () => {
      // 5 minutes past reset time
      const overdueTime = new Date('2026-09-14T00:04:00.000Z');

      const check = await scheduler.checkAndExecuteReset(overdueTime);

      assert.equal(check.checked, true);
      assert.equal(check.executed, true);
      assert.equal(check.result?.resetKey, 'scheduled:cycle-w36-1234');
      assert.equal(check.result?.resetType, 'scheduled');
    });
  });

  describe('2. Deterministic Reset Key & Duplicate Protection', () => {
    it('should use deterministic reset key `scheduled:<weekly_cycle_id>` and prevent double execution', async () => {
      const dueTime = new Date('2026-09-13T23:59:05.000Z');

      // 1. First trigger
      const firstCheck = await scheduler.checkAndExecuteReset(dueTime);
      assert.equal(firstCheck.executed, true);
      assert.equal(firstCheck.result?.resetKey, 'scheduled:cycle-w36-1234');

      // Verify the event was recorded in repo
      const recorded = await weeklyCycleRepo.getResetEventByKey('scheduled:cycle-w36-1234');
      assert.ok(recorded, 'Reset event must be recorded in ledger');
      assert.equal(recorded.resetKey, 'scheduled:cycle-w36-1234');
      assert.equal(recorded.resetType, 'scheduled');

      // 2. Direct second call with same cycle ID (duplicate execution attempt)
      const duplicateResult = await resetWeeklyCycleUseCase.execute({
        resetKey: 'scheduled:cycle-w36-1234',
        resetType: 'scheduled',
      });

      assert.equal(duplicateResult.success, true);
      assert.equal(duplicateResult.duplicate, true);
    });
  });

  describe('3. Timer Lifecycle', () => {
    it('should start and stop timer cleanly', () => {
      assert.equal(scheduler.isRunning(), false);

      scheduler.start();
      assert.equal(scheduler.isRunning(), true);

      // Calling start again when running should be a no-op
      scheduler.start();
      assert.equal(scheduler.isRunning(), true);

      scheduler.stop();
      assert.equal(scheduler.isRunning(), false);
    });
  });
});
