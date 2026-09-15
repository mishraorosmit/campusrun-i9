import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventBus } from '../events/EventBus';
import { InMemoryRealtimeService } from '../services/RealtimeService';
import { InMemoryPushSubscriptionRepository } from '../infrastructure/repositories/inmemory/InMemoryPushSubscriptionRepository';
import { InMemoryWebPushSender } from '../infrastructure/push/WebPushSender';
import { RealtimeEventHandler } from '../events/handlers/RealtimeEventHandler';
import { WebPushHandler } from '../events/handlers/WebPushHandler';
import { PushSubscription } from '../domain/entities/PushSubscription';
import { REALTIME_ROOMS } from '../infrastructure/realtime/events';
import {
  RotationTriggeredEvent,
  SpawnExpiredEvent,
  SpawnClaimedEvent,
  RankChangedEvent,
  ResetApproachingEvent,
  LeaderboardResetEvent,
} from '../domain/events';

describe('Realtime & Web Push Handlers for Domain Event System', () => {
  let eventBus: InMemoryEventBus;
  let realtimeService: InMemoryRealtimeService;
  let pushSubRepo: InMemoryPushSubscriptionRepository;
  let pushSender: InMemoryWebPushSender;
  let realtimeHandler: RealtimeEventHandler;
  let webPushHandler: WebPushHandler;

  const subUser1 = new PushSubscription({
    id: 'sub_u1_01',
    userId: 'user_runner_01',
    endpoint: 'https://fcm.googleapis.com/fcm/send/sub_01',
    p256dh: 'key_p256dh_01',
    auth: 'auth_secret_01',
    userAgent: 'Mozilla/5.0 Mobile',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const subUser2 = new PushSubscription({
    id: 'sub_u2_01',
    userId: 'user_runner_02',
    endpoint: 'https://fcm.googleapis.com/fcm/send/sub_02',
    p256dh: 'key_p256dh_02',
    auth: 'auth_secret_02',
    userAgent: 'Mozilla/5.0 Desktop',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    realtimeService = new InMemoryRealtimeService();
    pushSubRepo = new InMemoryPushSubscriptionRepository([subUser1, subUser2]);
    pushSender = new InMemoryWebPushSender();

    realtimeHandler = new RealtimeEventHandler(eventBus, realtimeService);
    webPushHandler = new WebPushHandler(eventBus, pushSubRepo, pushSender);
  });

  describe('1. RealtimeEventHandler Socket.IO Fan-Out', () => {
    it('SPAWN_ROTATED: broadcasts spawn:batch_created to campus_global with minimal delta', async () => {
      const event = new RotationTriggeredEvent({
        rotationId: 'rot_01',
        rotationNumber: 3,
        activatedSpawnCount: 10,
        expiresAt: new Date(Date.now() + 1800000),
      });

      await eventBus.publish(event);

      const batchEvent = realtimeService.emittedEvents.find((e) => e.event === 'spawn:batch_created');
      assert.ok(batchEvent, 'spawn:batch_created should be broadcasted');
      assert.strictEqual(batchEvent.room, REALTIME_ROOMS.GLOBAL);
      assert.strictEqual(batchEvent.payload.rotationNumber, 3);
      assert.ok(batchEvent.payload.expiresAt);
    });

    it('SPAWN_EXPIRED: broadcasts spawn:expired delta to campus_global', async () => {
      const event = new SpawnExpiredEvent({
        spawnIds: ['sp_lib_01'],
        spawnId: 'sp_lib_01',
        spawnCode: 'LIB01',
        reason: 'DISABLED',
        expiredAt: new Date(),
      });

      await eventBus.publish(event);

      const expiredEvent = realtimeService.emittedEvents.find((e) => e.event === 'spawn:expired');
      assert.ok(expiredEvent, 'spawn:expired should be broadcasted');
      assert.strictEqual(expiredEvent.room, REALTIME_ROOMS.GLOBAL);
      assert.deepStrictEqual(expiredEvent.payload.spawnIds, ['sp_lib_01']);
      assert.strictEqual(expiredEvent.payload.reason, 'DISABLED');
    });

    it('CLAIM_SUCCESS: broadcasts anonymous claim:success to campus_global and personal receipt to user room', async () => {
      const event = new SpawnClaimedEvent({
        claimId: 'claim_100',
        spawnId: 'sp_gym_01',
        spawnCode: 'GYM01',
        playerId: 'user_runner_01',
        pointsAwarded: 50,
        playerLat: 12.97,
        playerLng: 77.59,
        zoneId: 'zone_gym',
      });

      await eventBus.publish(event);

      // 1. Check anonymous global broadcast
      const globalClaim = realtimeService.emittedEvents.find((e) => e.event === 'claim:success');
      assert.ok(globalClaim);
      assert.strictEqual(globalClaim.room, REALTIME_ROOMS.GLOBAL);
      assert.strictEqual(globalClaim.payload.spawnId, 'sp_gym_01');
      assert.strictEqual(globalClaim.payload.pointsAwarded, 50);
      assert.strictEqual((globalClaim.payload as any).playerId, undefined, 'Must not leak playerId in global broadcast');

      // 2. Check personal claim receipt in user:<userId> room
      const personalClaim = realtimeService.emittedEvents.find((e) => e.event === 'claim:success_personal');
      assert.ok(personalClaim);
      assert.strictEqual(personalClaim.room, REALTIME_ROOMS.USER('user_runner_01'));
      assert.strictEqual(personalClaim.payload.playerId, 'user_runner_01');
      assert.strictEqual(personalClaim.payload.claimId, 'claim_100');
    });

    it('RANK_CHANGED: broadcasts minimal player rank delta update to campus_global', async () => {
      const event = new RankChangedEvent({
        playerId: 'user_runner_02',
        username: 'RunnerTwo',
        oldRank: 4,
        newRank: 2,
        points: 250,
        period: 'weekly',
        timestamp: new Date(),
      });

      await eventBus.publish(event);

      const lbUpdated = realtimeService.emittedEvents.find((e) => e.event === 'leaderboard:updated');
      assert.ok(lbUpdated);
      assert.strictEqual(lbUpdated.room, REALTIME_ROOMS.GLOBAL);
      assert.strictEqual(lbUpdated.payload.type, 'weekly');
      assert.strictEqual(lbUpdated.payload.playerRankDelta.playerId, 'user_runner_02');
      assert.strictEqual(lbUpdated.payload.playerRankDelta.newRank, 2);
    });

    it('WEEKLY_RESET: broadcasts leaderboard:weekly_reset to campus_global', async () => {
      const event = new LeaderboardResetEvent({
        cycleId: 'cycle_01',
        resetKey: 'manual:reset_01',
        resetTimestamp: new Date(),
        period: 'weekly',
      });

      await eventBus.publish(event);

      const resetEvent = realtimeService.emittedEvents.find((e) => e.event === 'leaderboard:weekly_reset');
      assert.ok(resetEvent);
      assert.strictEqual(resetEvent.room, REALTIME_ROOMS.GLOBAL);
      assert.strictEqual(resetEvent.payload.cycleId, 'cycle_01');
      assert.strictEqual(resetEvent.payload.resetKey, 'manual:reset_01');
    });
  });

  describe('2. WebPushHandler Push Notifications', () => {
    it('CLAIM_SUCCESS: dispatches push notification ONLY to subscriptions of the claiming player', async () => {
      const event = new SpawnClaimedEvent({
        claimId: 'claim_200',
        spawnId: 'sp_lib_01',
        spawnCode: 'LIB01',
        playerId: 'user_runner_01',
        pointsAwarded: 100,
        playerLat: 12.97,
        playerLng: 77.59,
        zoneId: 'zone_central',
      });

      await eventBus.publish(event);

      // Verify push dispatched only to user 1
      assert.strictEqual(pushSender.sentPushes.length, 1);
      const push = pushSender.sentPushes[0];
      assert.strictEqual(push.subscription.userId, 'user_runner_01');
      assert.strictEqual(push.payload.title, 'Spawn Claimed!');
      assert.match(push.payload.body, /LIB01/);
      assert.match(push.payload.body, /\+100 points/);
    });

    it('RANK_CHANGED: dispatches personal push notification ONLY to subscriptions of the affected player', async () => {
      const event = new RankChangedEvent({
        playerId: 'user_runner_02',
        username: 'RunnerTwo',
        oldRank: 3,
        newRank: 1,
        points: 400,
        period: 'weekly',
        timestamp: new Date(),
      });

      await eventBus.publish(event);

      // Verify push dispatched only to user 2
      assert.strictEqual(pushSender.sentPushes.length, 1);
      const push = pushSender.sentPushes[0];
      assert.strictEqual(push.subscription.userId, 'user_runner_02');
      assert.strictEqual(push.payload.title, 'Rank Updated!');
      assert.match(push.payload.body, /#3 to #1/);
    });

    it('SPAWN_ROTATED: dispatches push notification to all subscribed players', async () => {
      const event = new RotationTriggeredEvent({
        rotationId: 'rot_02',
        rotationNumber: 5,
        activatedSpawnCount: 12,
        expiresAt: new Date(Date.now() + 1800000),
      });

      await eventBus.publish(event);

      // Both user 1 and user 2 receive push
      assert.strictEqual(pushSender.sentPushes.length, 2);
      assert.ok(pushSender.sentPushes.some((p) => p.subscription.userId === 'user_runner_01'));
      assert.ok(pushSender.sentPushes.some((p) => p.subscription.userId === 'user_runner_02'));
      assert.strictEqual(pushSender.sentPushes[0].payload.title, 'New Spawns Available!');
    });

    it('RESET_APPROACHING: dispatches reminder push notification to all subscribed players', async () => {
      const event = new ResetApproachingEvent({
        cycleId: 'cycle_week_02',
        endsAt: new Date(Date.now() + 20 * 60000),
        minutesRemaining: 20,
        timestamp: new Date(),
      });

      await eventBus.publish(event);

      assert.strictEqual(pushSender.sentPushes.length, 2);
      assert.strictEqual(pushSender.sentPushes[0].payload.title, 'Weekly Reset Approaching!');
      assert.match(pushSender.sentPushes[0].payload.body, /20 minutes/);
    });

    it('WEEKLY_RESET: dispatches weekly reset announcement push notification to all subscribed players', async () => {
      const event = new LeaderboardResetEvent({
        cycleId: 'cycle_02',
        resetKey: 'manual:reset_02',
        resetTimestamp: new Date(),
        period: 'weekly',
      });

      await eventBus.publish(event);

      assert.strictEqual(pushSender.sentPushes.length, 2);
      assert.strictEqual(pushSender.sentPushes[0].payload.title, 'Weekly Leaderboard Reset');
    });
  });

  describe('3. Fault Isolation & Cross-Handler Independence', () => {
    it('failures in Web Push dispatch do NOT crash RealtimeEventHandler or EventBus', async () => {
      const brokenPushSender: InMemoryWebPushSender = {
        sentPushes: [],
        sendPush: async () => {
          throw new Error('FCM / VAPID transport endpoint unreachable');
        },
        clear: () => {},
      } as any;

      const failingWebPushHandler = new WebPushHandler(eventBus, pushSubRepo, brokenPushSender);

      // Publishing should not throw
      await assert.doesNotReject(async () => {
        await eventBus.publish(
          new SpawnClaimedEvent({
            claimId: 'claim_err_01',
            spawnId: 'sp_1',
            spawnCode: 'SP01',
            playerId: 'user_runner_01',
            pointsAwarded: 30,
            playerLat: 10,
            playerLng: 10,
            zoneId: 'z1',
          })
        );
      });

      // Verify realtime handler still received and processed the event successfully
      const globalClaim = realtimeService.emittedEvents.find((e) => e.event === 'claim:success');
      assert.ok(globalClaim, 'Realtime event must still be emitted despite push failure');

      failingWebPushHandler.unregister();
    });

    it('unsubscribing cleanly stops event dispatching', async () => {
      realtimeHandler.unregister();
      webPushHandler.unregister();

      await eventBus.publish(
        new RotationTriggeredEvent({
          rotationId: 'rot_unsub',
          rotationNumber: 1,
          activatedSpawnCount: 5,
          expiresAt: new Date(),
        })
      );

      assert.strictEqual(realtimeService.emittedEvents.length, 0);
      assert.strictEqual(pushSender.sentPushes.length, 0);
    });
  });
});
