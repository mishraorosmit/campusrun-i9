import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventBus } from '../events/EventBus';
import { InMemoryNotificationRepository } from '../infrastructure/repositories/inmemory/InMemoryNotificationRepository';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { InMemoryPushSubscriptionRepository } from '../infrastructure/repositories/inmemory/InMemoryPushSubscriptionRepository';
import { InMemoryAnalyticsRepository } from '../infrastructure/repositories/inmemory/InMemoryAnalyticsRepository';
import { InMemoryRealtimeService } from '../services/RealtimeService';
import { InMemoryWebPushSender } from '../infrastructure/push/WebPushSender';
import { DatabaseNotificationHandler } from '../events/handlers/DatabaseNotificationHandler';
import { RealtimeEventHandler } from '../events/handlers/RealtimeEventHandler';
import { WebPushHandler } from '../events/handlers/WebPushHandler';
import { AnalyticsHandler } from '../events/handlers/AnalyticsHandler';
import { Player } from '../domain/entities/Player';
import { PushSubscription } from '../domain/entities/PushSubscription';
import {
  RotationTriggeredEvent,
  SpawnExpiredEvent,
  SpawnClaimedEvent,
  RankChangedEvent,
  ResetApproachingEvent,
  LeaderboardResetEvent,
} from '../domain/events';

describe('Event System 4-Way Fan-Out Integration (Notifications, Realtime, Push, Analytics)', () => {
  let eventBus: InMemoryEventBus;
  let notificationRepo: InMemoryNotificationRepository;
  let playerRepo: InMemoryPlayerRepository;
  let pushSubRepo: InMemoryPushSubscriptionRepository;
  let analyticsRepo: InMemoryAnalyticsRepository;
  let realtimeService: InMemoryRealtimeService;
  let pushSender: InMemoryWebPushSender;

  let dbNotifHandler: DatabaseNotificationHandler;
  let realtimeHandler: RealtimeEventHandler;
  let webPushHandler: WebPushHandler;
  let analyticsHandler: AnalyticsHandler;

  const player1 = new Player({
    id: 'user_player_01',
    username: 'PlayerOne',
    email: 'p1@campus.edu',
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
    id: 'user_player_02',
    username: 'PlayerTwo',
    email: 'p2@campus.edu',
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

  const sub1 = new PushSubscription({
    id: 'sub_1',
    userId: 'user_player_01',
    endpoint: 'https://push.example.com/p1',
    p256dh: 'key1',
    auth: 'auth1',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const sub2 = new PushSubscription({
    id: 'sub_2',
    userId: 'user_player_02',
    endpoint: 'https://push.example.com/p2',
    p256dh: 'key2',
    auth: 'auth2',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    notificationRepo = new InMemoryNotificationRepository();
    playerRepo = new InMemoryPlayerRepository([player1, player2]);
    pushSubRepo = new InMemoryPushSubscriptionRepository([sub1, sub2]);
    analyticsRepo = new InMemoryAnalyticsRepository();
    realtimeService = new InMemoryRealtimeService();
    pushSender = new InMemoryWebPushSender();

    // Register all 4 handlers
    dbNotifHandler = new DatabaseNotificationHandler(eventBus, notificationRepo, playerRepo);
    realtimeHandler = new RealtimeEventHandler(eventBus, realtimeService);
    webPushHandler = new WebPushHandler(eventBus, pushSubRepo, pushSender);
    analyticsHandler = new AnalyticsHandler(eventBus, analyticsRepo);
  });

  describe('1. Six Domain Events Fan-Out Across All 4 Handlers', () => {
    it('1. SPAWN_ROTATED reaches all 4 handlers', async () => {
      const event = new RotationTriggeredEvent({
        rotationId: 'rot_batch_01',
        rotationNumber: 10,
        activatedSpawnCount: 8,
        expiresAt: new Date(Date.now() + 3600000),
      });

      await eventBus.publish(event);

      // Handler 1: Database Notifications
      const notifsP1 = await notificationRepo.findByUserId('user_player_01');
      assert.strictEqual(notifsP1.length, 1);
      assert.strictEqual(notifsP1[0].type, 'spawn_rotation');

      // Handler 2: Realtime Socket.IO
      const rtEvent = realtimeService.emittedEvents.find((e) => e.event === 'spawn:batch_created');
      assert.ok(rtEvent, 'Realtime spawn:batch_created should be emitted');
      assert.strictEqual(rtEvent.payload.rotationNumber, 10);

      // Handler 3: Web Push
      assert.strictEqual(pushSender.sentPushes.length, 2);
      assert.strictEqual(pushSender.sentPushes[0].payload.title, 'New Spawns Available!');

      // Handler 4: Analytics
      assert.strictEqual(analyticsRepo.records.length, 1);
      assert.strictEqual(analyticsRepo.records[0].eventName, 'SPAWN_ROTATED');
      assert.strictEqual(analyticsRepo.records[0].properties?.rotationNumber, 10);
    });

    it('2. SPAWN_EXPIRED reaches all 4 handlers', async () => {
      const event = new SpawnExpiredEvent({
        spawnIds: ['sp_01'],
        spawnId: 'sp_01',
        spawnCode: 'CODE01',
        reason: 'DISABLED',
        expiredAt: new Date(),
      });

      await eventBus.publish(event);

      // Handler 1: Database Notifications
      const notifsP1 = await notificationRepo.findByUserId('user_player_01');
      assert.strictEqual(notifsP1.length, 1);
      assert.match(notifsP1[0].body, /CODE01/);

      // Handler 2: Realtime Socket.IO
      const rtEvent = realtimeService.emittedEvents.find((e) => e.event === 'spawn:expired');
      assert.ok(rtEvent);
      assert.deepStrictEqual(rtEvent.payload.spawnIds, ['sp_01']);

      // Handler 3: Analytics
      assert.strictEqual(analyticsRepo.records.length, 1);
      assert.strictEqual(analyticsRepo.records[0].eventName, 'SPAWN_EXPIRED');
    });

    it('3. CLAIM_SUCCESS reaches all 4 handlers with strict personal targeting', async () => {
      const event = new SpawnClaimedEvent({
        claimId: 'clm_100',
        spawnId: 'sp_01',
        spawnCode: 'CODE01',
        playerId: 'user_player_01',
        pointsAwarded: 50,
        playerLat: 10,
        playerLng: 20,
        zoneId: 'z1',
      });

      await eventBus.publish(event);

      // Handler 1: Database Notifications (Personal: player 1 only)
      const notifsP1 = await notificationRepo.findByUserId('user_player_01');
      const notifsP2 = await notificationRepo.findByUserId('user_player_02');
      assert.strictEqual(notifsP1.length, 1);
      assert.strictEqual(notifsP2.length, 0, 'Player 2 must not receive personal claim notification');
      assert.strictEqual(notifsP1[0].type, 'claim_reward');

      // Handler 2: Realtime Socket.IO (Public claim + Personal claim receipt)
      const pubClaim = realtimeService.emittedEvents.find((e) => e.event === 'claim:success');
      const privClaim = realtimeService.emittedEvents.find((e) => e.event === 'claim:success_personal');
      assert.ok(pubClaim, 'Public claim broadcast');
      assert.ok(privClaim, 'Personal claim receipt');
      assert.strictEqual(privClaim.room, 'user:user_player_01');

      // Handler 3: Web Push (Personal: player 1 only)
      assert.strictEqual(pushSender.sentPushes.length, 1);
      assert.strictEqual(pushSender.sentPushes[0].subscription.userId, 'user_player_01');
      assert.strictEqual(pushSender.sentPushes[0].payload.title, 'Spawn Claimed!');

      // Handler 4: Analytics
      assert.strictEqual(analyticsRepo.records.length, 1);
      assert.strictEqual(analyticsRepo.records[0].eventName, 'CLAIM_SUCCESS');
      assert.strictEqual(analyticsRepo.records[0].userId, 'user_player_01');
      assert.strictEqual(analyticsRepo.records[0].properties?.points, 50);
    });

    it('4. RANK_CHANGED reaches all 4 handlers with strict personal targeting', async () => {
      const event = new RankChangedEvent({
        playerId: 'user_player_02',
        username: 'PlayerTwo',
        oldRank: 5,
        newRank: 2,
        points: 300,
        period: 'weekly',
        timestamp: new Date(),
      });

      await eventBus.publish(event);

      // Handler 1: Database Notifications (Personal: player 2 only)
      const notifsP1 = await notificationRepo.findByUserId('user_player_01');
      const notifsP2 = await notificationRepo.findByUserId('user_player_02');
      assert.strictEqual(notifsP1.length, 0);
      assert.strictEqual(notifsP2.length, 1);
      assert.strictEqual(notifsP2[0].type, 'leaderboard_rank');

      // Handler 2: Realtime Socket.IO
      const rtEvent = realtimeService.emittedEvents.find((e) => e.event === 'leaderboard:updated');
      assert.ok(rtEvent);
      assert.strictEqual(rtEvent.payload.playerRankDelta.playerId, 'user_player_02');
      assert.strictEqual(rtEvent.payload.playerRankDelta.newRank, 2);

      // Handler 3: Web Push (Personal: player 2 only)
      assert.strictEqual(pushSender.sentPushes.length, 1);
      assert.strictEqual(pushSender.sentPushes[0].subscription.userId, 'user_player_02');

      // Handler 4: Analytics
      assert.strictEqual(analyticsRepo.records.length, 1);
      assert.strictEqual(analyticsRepo.records[0].eventName, 'RANK_CHANGED');
      assert.strictEqual(analyticsRepo.records[0].userId, 'user_player_02');
    });

    it('5. RESET_APPROACHING reaches all 4 handlers', async () => {
      const event = new ResetApproachingEvent({
        cycleId: 'cycle_w1',
        endsAt: new Date(Date.now() + 15 * 60000),
        minutesRemaining: 15,
        timestamp: new Date(),
      });

      await eventBus.publish(event);

      // Handler 1: Database Notifications
      const notifsP1 = await notificationRepo.findByUserId('user_player_01');
      assert.strictEqual(notifsP1.length, 1);
      assert.strictEqual(notifsP1[0].type, 'streak_reminder');

      // Handler 2: Realtime Socket.IO
      const rtEvent = realtimeService.emittedEvents.find((e) => e.event === 'leaderboard:tick');
      assert.ok(rtEvent);

      // Handler 3: Web Push
      assert.strictEqual(pushSender.sentPushes.length, 2);
      assert.strictEqual(pushSender.sentPushes[0].payload.title, 'Weekly Reset Approaching!');

      // Handler 4: Analytics
      assert.strictEqual(analyticsRepo.records.length, 1);
      assert.strictEqual(analyticsRepo.records[0].eventName, 'RESET_APPROACHING');
      assert.strictEqual(analyticsRepo.records[0].properties?.minutesRemaining, 15);
    });

    it('6. WEEKLY_RESET reaches all 4 handlers', async () => {
      const event = new LeaderboardResetEvent({
        cycleId: 'cycle_01',
        resetKey: 'manual:reset_01',
        resetTimestamp: new Date(),
        period: 'weekly',
      });

      await eventBus.publish(event);

      // Handler 1: Database Notifications
      const notifsP1 = await notificationRepo.findByUserId('user_player_01');
      assert.strictEqual(notifsP1.length, 1);
      assert.strictEqual(notifsP1[0].type, 'system_announcement');

      // Handler 2: Realtime Socket.IO
      const rtEvent = realtimeService.emittedEvents.find((e) => e.event === 'leaderboard:weekly_reset');
      assert.ok(rtEvent);

      // Handler 3: Web Push
      assert.strictEqual(pushSender.sentPushes.length, 2);
      assert.strictEqual(pushSender.sentPushes[0].payload.title, 'Weekly Leaderboard Reset');

      // Handler 4: Analytics
      assert.strictEqual(analyticsRepo.records.length, 1);
      assert.strictEqual(analyticsRepo.records[0].eventName, 'WEEKLY_RESET');
      assert.strictEqual(analyticsRepo.records[0].properties?.cycleId, 'cycle_01');
    });
  });

  describe('2. Handler Error Isolation (Fault Tolerance)', () => {
    it('a failure in one handler does NOT prevent other handlers from executing', async () => {
      // Create a broken notification repo that throws
      const brokenNotifRepo: any = {
        save: async () => {
          throw new Error('Database disk full');
        },
        saveBatch: async () => {
          throw new Error('Database disk full');
        },
      };

      const failingDbHandler = new DatabaseNotificationHandler(eventBus, brokenNotifRepo, playerRepo);

      const event = new SpawnClaimedEvent({
        claimId: 'clm_isolated_01',
        spawnId: 'sp_01',
        spawnCode: 'CODE01',
        playerId: 'user_player_01',
        pointsAwarded: 50,
        playerLat: 10,
        playerLng: 20,
        zoneId: 'z1',
      });

      // Publishing should NOT throw
      await assert.doesNotReject(async () => {
        await eventBus.publish(event);
      });

      // Realtime handler still succeeded
      const pubClaim = realtimeService.emittedEvents.find((e) => e.event === 'claim:success');
      assert.ok(pubClaim, 'Realtime handler must still execute');

      // Web Push handler still succeeded
      assert.strictEqual(pushSender.sentPushes.length, 1, 'Web push handler must still execute');

      // Analytics handler still succeeded
      assert.strictEqual(analyticsRepo.records.length, 1, 'Analytics handler must still execute');

      failingDbHandler.unregister();
    });
  });
});
