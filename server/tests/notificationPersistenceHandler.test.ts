import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventBus } from '../events/EventBus';
import { InMemoryNotificationRepository } from '../infrastructure/repositories/inmemory/InMemoryNotificationRepository';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { NotificationPersistenceHandler } from '../events/handlers/NotificationPersistenceHandler';
import { Player } from '../domain/entities/Player';
import {
  RotationTriggeredEvent,
  SpawnExpiredEvent,
  SpawnClaimedEvent,
  RankChangedEvent,
  ResetApproachingEvent,
  LeaderboardResetEvent,
} from '../domain/events';

describe('NotificationPersistenceHandler for Domain Event Bus', () => {
  let eventBus: InMemoryEventBus;
  let notificationRepo: InMemoryNotificationRepository;
  let playerRepo: InMemoryPlayerRepository;
  let handler: NotificationPersistenceHandler;

  const player1 = new Player({
    id: 'user_runner_01',
    username: 'RunnerOne',
    email: 'runner1@campus.edu',
    role: 'STUDENT',
    totalPoints: 100,
    seasonPoints: 100,
    rank: 1,
    tier: 'tier1',
    claimsCount: 2,
    currentStreakDays: 2,
    createdAt: new Date(),
    lastActiveAt: new Date(),
  });

  const player2 = new Player({
    id: 'user_runner_02',
    username: 'RunnerTwo',
    email: 'runner2@campus.edu',
    role: 'STUDENT',
    totalPoints: 50,
    seasonPoints: 50,
    rank: 2,
    tier: 'tier1',
    claimsCount: 1,
    currentStreakDays: 1,
    createdAt: new Date(),
    lastActiveAt: new Date(),
  });

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    notificationRepo = new InMemoryNotificationRepository();
    playerRepo = new InMemoryPlayerRepository([player1, player2]);
    handler = new NotificationPersistenceHandler(eventBus, notificationRepo, playerRepo);
  });

  describe('1. SpawnClaimedEvent -> type: CLAIM_SUCCESS, entity_type: claim, entity_id: claimId', () => {
    it('creates a personal CLAIM_SUCCESS notification strictly for the claiming player with claim entity references', async () => {
      const event = new SpawnClaimedEvent({
        claimId: 'claim_abc_123',
        spawnId: 'sp_lib_01',
        spawnCode: 'LIB01',
        playerId: 'user_runner_01',
        pointsAwarded: 50,
        playerLat: 12.9716,
        playerLng: 77.5946,
        zoneId: 'zone_central',
      });

      await eventBus.publish(event);

      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      assert.strictEqual(notifsPlayer1.length, 1);
      const notif1 = notifsPlayer1[0];

      assert.strictEqual(notif1.userId, 'user_runner_01');
      assert.strictEqual(notif1.type, 'CLAIM_SUCCESS');
      assert.strictEqual(notif1.entityType, 'claim');
      assert.strictEqual(notif1.entityId, 'claim_abc_123');
      assert.strictEqual(notif1.title, 'Spawn Claimed!');
      assert.match(notif1.body, /LIB01/);
      assert.match(notif1.body, /\+50 points/);
      assert.strictEqual(notif1.read, false);
      assert.strictEqual(notif1.readAt, null);

      // Verify user 2 was NOT notified
      const notifsPlayer2 = await notificationRepo.findByUserId('user_runner_02');
      assert.strictEqual(notifsPlayer2.length, 0);
    });
  });

  describe('2. RankChangedEvent -> type: RANK_CHANGED, entity_type: leaderboard, entity_id: userId', () => {
    it('creates a personal RANK_CHANGED notification strictly for the affected player with leaderboard entity references', async () => {
      const event = new RankChangedEvent({
        playerId: 'user_runner_02',
        username: 'RunnerTwo',
        oldRank: 5,
        newRank: 2,
        points: 120,
        period: 'weekly',
        timestamp: new Date(),
      });

      await eventBus.publish(event);

      const notifsPlayer2 = await notificationRepo.findByUserId('user_runner_02');
      assert.strictEqual(notifsPlayer2.length, 1);
      const notif2 = notifsPlayer2[0];

      assert.strictEqual(notif2.userId, 'user_runner_02');
      assert.strictEqual(notif2.type, 'RANK_CHANGED');
      assert.strictEqual(notif2.entityType, 'leaderboard');
      assert.strictEqual(notif2.entityId, 'user_runner_02');
      assert.strictEqual(notif2.title, 'Leaderboard Rank Updated');
      assert.match(notif2.body, /#5 to #2/);
      assert.match(notif2.body, /120 points/);
      assert.strictEqual(notif2.read, false);

      // Verify player 1 was NOT notified
      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      assert.strictEqual(notifsPlayer1.length, 0);
    });
  });

  describe('3. LeaderboardResetEvent -> type: WEEKLY_RESET, entity_type: cycle, entity_id: cycleId', () => {
    it('creates a WEEKLY_RESET notification for all registered players with cycle entity references', async () => {
      const event = new LeaderboardResetEvent({
        cycleId: 'cycle_week_42',
        resetKey: 'scheduled:cycle_week_42',
        resetTimestamp: new Date(),
        period: 'weekly',
      });

      await eventBus.publish(event);

      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      const notifsPlayer2 = await notificationRepo.findByUserId('user_runner_02');

      assert.strictEqual(notifsPlayer1.length, 1);
      assert.strictEqual(notifsPlayer2.length, 1);

      assert.strictEqual(notifsPlayer1[0].type, 'WEEKLY_RESET');
      assert.strictEqual(notifsPlayer1[0].entityType, 'cycle');
      assert.strictEqual(notifsPlayer1[0].entityId, 'cycle_week_42');
      assert.strictEqual(notifsPlayer1[0].title, 'Weekly Leaderboard Reset');
      assert.match(notifsPlayer1[0].body, /reset to 0/i);
    });
  });

  describe('4. RotationTriggeredEvent & SpawnExpiredEvent -> Spawn Notifications', () => {
    it('creates SPAWN_ROTATED notifications with spawn entity references', async () => {
      const event = new RotationTriggeredEvent({
        rotationId: 'rot_batch_99',
        rotationNumber: 5,
        activatedSpawnCount: 12,
        expiresAt: new Date(Date.now() + 1800 * 1000),
      });

      await eventBus.publish(event);

      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      assert.strictEqual(notifsPlayer1.length, 1);
      assert.strictEqual(notifsPlayer1[0].type, 'SPAWN_ROTATED');
      assert.strictEqual(notifsPlayer1[0].entityType, 'spawn');
      assert.strictEqual(notifsPlayer1[0].entityId, 'rot_batch_99');
    });

    it('creates SPAWN_EXPIRED notifications with spawn entity references', async () => {
      const event = new SpawnExpiredEvent({
        spawnIds: ['sp_lib_02'],
        spawnId: 'sp_lib_02',
        spawnCode: 'LIB02',
        reason: 'WINDOW_EXPIRED',
        expiredAt: new Date(),
      });

      await eventBus.publish(event);

      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      assert.strictEqual(notifsPlayer1.length, 1);
      assert.strictEqual(notifsPlayer1[0].type, 'SPAWN_EXPIRED');
      assert.strictEqual(notifsPlayer1[0].entityType, 'spawn');
      assert.strictEqual(notifsPlayer1[0].entityId, 'sp_lib_02');
    });
  });

  describe('5. Fault Tolerance & Safety', () => {
    it('catches database errors without crashing event bus or preventing other operations', async () => {
      const brokenRepo: any = {
        save: async () => {
          throw new Error('Postgres connection pool exhausted');
        },
        saveBatch: async () => {
          throw new Error('Postgres connection pool exhausted');
        },
      };

      const failingHandler = new NotificationPersistenceHandler(eventBus, brokenRepo, playerRepo);

      await assert.doesNotReject(async () => {
        await eventBus.publish(
          new SpawnClaimedEvent({
            claimId: 'claim_err_01',
            spawnId: 'sp_01',
            spawnCode: 'SP01',
            playerId: 'user_runner_01',
            pointsAwarded: 25,
            playerLat: 10,
            playerLng: 10,
            zoneId: 'z1',
          })
        );
      });

      failingHandler.unregister();
    });

    it('unregisters cleanly and stops persisting events', async () => {
      handler.unregister();

      await eventBus.publish(
        new SpawnClaimedEvent({
          claimId: 'claim_after_unsub',
          spawnId: 'sp_01',
          spawnCode: 'SP01',
          playerId: 'user_runner_01',
          pointsAwarded: 25,
          playerLat: 10,
          playerLng: 10,
          zoneId: 'z1',
        })
      );

      const notifs = await notificationRepo.findByUserId('user_runner_01');
      assert.strictEqual(notifs.length, 0);
    });
  });
});
