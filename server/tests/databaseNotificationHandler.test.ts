import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventBus } from '../events/EventBus';
import { InMemoryNotificationRepository } from '../infrastructure/repositories/inmemory/InMemoryNotificationRepository';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { DatabaseNotificationHandler } from '../events/handlers/DatabaseNotificationHandler';
import { Player } from '../domain/entities/Player';
import {
  RotationTriggeredEvent,
  SpawnExpiredEvent,
  SpawnClaimedEvent,
  RankChangedEvent,
  ResetApproachingEvent,
  LeaderboardResetEvent,
} from '../domain/events';

describe('Database Notification Handler for Internal Event System', () => {
  let eventBus: InMemoryEventBus;
  let notificationRepo: InMemoryNotificationRepository;
  let playerRepo: InMemoryPlayerRepository;
  let handler: DatabaseNotificationHandler;

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
    handler = new DatabaseNotificationHandler(eventBus, notificationRepo, playerRepo);
  });

  describe('1. CLAIM_SUCCESS -> Personal Notification', () => {
    it('creates a personal claim_reward notification ONLY for the claiming player', async () => {
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

      // Verify notification for player 1
      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      assert.strictEqual(notifsPlayer1.length, 1);
      const notif1 = notifsPlayer1[0];
      assert.strictEqual(notif1.userId, 'user_runner_01');
      assert.strictEqual(notif1.type, 'claim_reward');
      assert.strictEqual(notif1.title, 'Spawn Claimed!');
      assert.match(notif1.body, /LIB01/);
      assert.match(notif1.body, /\+50 points/);
      assert.strictEqual(notif1.entityType, 'claim');
      assert.strictEqual(notif1.read, false);
      assert.strictEqual(notif1.readAt, null);

      // Verify NO notification was created for player 2
      const notifsPlayer2 = await notificationRepo.findByUserId('user_runner_02');
      assert.strictEqual(notifsPlayer2.length, 0);
    });
  });

  describe('2. RANK_CHANGED -> Personal Notification', () => {
    it('creates a personal leaderboard_rank notification ONLY for the affected player', async () => {
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

      // Verify notification for player 2
      const notifsPlayer2 = await notificationRepo.findByUserId('user_runner_02');
      assert.strictEqual(notifsPlayer2.length, 1);
      const notif2 = notifsPlayer2[0];
      assert.strictEqual(notif2.userId, 'user_runner_02');
      assert.strictEqual(notif2.type, 'leaderboard_rank');
      assert.strictEqual(notif2.title, 'Leaderboard Rank Updated');
      assert.match(notif2.body, /#5 to #2/);
      assert.match(notif2.body, /120 points/);
      assert.strictEqual(notif2.entityType, 'weekly_cycle');
      assert.strictEqual(notif2.read, false);

      // Verify NO notification for player 1
      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      assert.strictEqual(notifsPlayer1.length, 0);
    });
  });

  describe('3. SPAWN_ROTATED -> Global Notification', () => {
    it('creates a spawn_rotation notification for all registered players', async () => {
      const event = new RotationTriggeredEvent({
        rotationId: 'rot_batch_01',
        rotationNumber: 4,
        activatedSpawnCount: 15,
        expiresAt: new Date(Date.now() + 1800 * 1000),
      });

      await eventBus.publish(event);

      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      const notifsPlayer2 = await notificationRepo.findByUserId('user_runner_02');

      assert.strictEqual(notifsPlayer1.length, 1);
      assert.strictEqual(notifsPlayer2.length, 1);

      assert.strictEqual(notifsPlayer1[0].type, 'spawn_rotation');
      assert.strictEqual(notifsPlayer1[0].entityType, 'spawn_batch');
      assert.match(notifsPlayer1[0].body, /15 new point drops/);
      assert.match(notifsPlayer1[0].body, /Rotation #4/);
      assert.strictEqual(notifsPlayer1[0].read, false);
    });
  });

  describe('4. SPAWN_EXPIRED -> Notification', () => {
    it('creates a spawn_rotation expiration notification for players', async () => {
      const event = new SpawnExpiredEvent({
        spawnIds: ['sp_lib_01'],
        spawnId: 'sp_lib_01',
        spawnCode: 'LIB01',
        reason: 'DISABLED',
        expiredAt: new Date(),
      });

      await eventBus.publish(event);

      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      assert.strictEqual(notifsPlayer1.length, 1);
      assert.strictEqual(notifsPlayer1[0].type, 'spawn_rotation');
      assert.strictEqual(notifsPlayer1[0].entityType, 'spawn_point');
      assert.match(notifsPlayer1[0].body, /LIB01/);
      assert.match(notifsPlayer1[0].body, /DISABLED/i);
    });
  });

  describe('5. RESET_APPROACHING -> Notification', () => {
    it('creates a streak_reminder / reset approaching notification for players', async () => {
      const event = new ResetApproachingEvent({
        cycleId: 'cycle_week_01',
        endsAt: new Date(Date.now() + 30 * 60 * 1000),
        minutesRemaining: 30,
        timestamp: new Date(),
      });

      await eventBus.publish(event);

      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      assert.strictEqual(notifsPlayer1.length, 1);
      assert.strictEqual(notifsPlayer1[0].type, 'streak_reminder');
      assert.strictEqual(notifsPlayer1[0].entityType, 'weekly_cycle');
      assert.match(notifsPlayer1[0].body, /30 minutes/);
    });
  });

  describe('6. WEEKLY_RESET -> Global Notification', () => {
    it('creates a system_announcement weekly reset notification for all players', async () => {
      const event = new LeaderboardResetEvent({
        cycleId: 'cycle_completed_01',
        resetKey: 'manual:reset_01',
        resetTimestamp: new Date(),
        period: 'weekly',
      });

      await eventBus.publish(event);

      const notifsPlayer1 = await notificationRepo.findByUserId('user_runner_01');
      const notifsPlayer2 = await notificationRepo.findByUserId('user_runner_02');

      assert.strictEqual(notifsPlayer1.length, 1);
      assert.strictEqual(notifsPlayer2.length, 1);

      assert.strictEqual(notifsPlayer1[0].type, 'system_announcement');
      assert.strictEqual(notifsPlayer1[0].title, 'Weekly Leaderboard Reset');
      assert.strictEqual(notifsPlayer1[0].entityType, 'weekly_cycle');
    });
  });

  describe('7. Fault Tolerance & Safety', () => {
    it('catches repository errors without crashing or bubbling to the EventBus', async () => {
      const brokenRepo: any = {
        save: async () => {
          throw new Error('Database connection crashed during notification write');
        },
        saveBatch: async () => {
          throw new Error('Database connection crashed during batch write');
        },
      };

      const resilientHandler = new DatabaseNotificationHandler(eventBus, brokenRepo, playerRepo);

      // Verify publishing does not throw even with broken repo
      await assert.doesNotReject(async () => {
        await eventBus.publish(
          new SpawnClaimedEvent({
            claimId: 'claim_1',
            spawnId: 'sp_1',
            spawnCode: 'SP01',
            playerId: 'user_runner_01',
            pointsAwarded: 10,
            playerLat: 10,
            playerLng: 10,
            zoneId: 'z1',
          })
        );
        await eventBus.publish(
          new RotationTriggeredEvent({
            rotationId: 'r1',
            rotationNumber: 1,
            activatedSpawnCount: 5,
            expiresAt: new Date(),
          })
        );
      });

      resilientHandler.unregister();
    });

    it('unregisters cleanly and stops receiving events', async () => {
      handler.unregister();

      await eventBus.publish(
        new SpawnClaimedEvent({
          claimId: 'claim_unsub_1',
          spawnId: 'sp_1',
          spawnCode: 'SP01',
          playerId: 'user_runner_01',
          pointsAwarded: 10,
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
