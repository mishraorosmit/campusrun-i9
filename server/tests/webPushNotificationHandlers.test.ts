import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventBus } from '../events/EventBus';
import { WebPushHandler } from '../events/handlers/WebPushHandler';
import { PushDeliveryService } from '../services/PushDeliveryService';
import { InMemoryPushSubscriptionRepository } from '../infrastructure/repositories/inmemory/InMemoryPushSubscriptionRepository';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { PushSubscription } from '../domain/entities/PushSubscription';
import { Player } from '../domain/entities/Player';
import {
  RotationTriggeredEvent,
  SpawnExpiredEvent,
  SpawnClaimedEvent,
  RankChangedEvent,
  ResetApproachingEvent,
  LeaderboardResetEvent,
} from '../domain/events';

describe('Web Push Notification Handlers Wired to Internal Event Bus', () => {
  let eventBus: InMemoryEventBus;
  let pushRepo: InMemoryPushSubscriptionRepository;
  let playerRepo: InMemoryPlayerRepository;
  let deliveredPushes: Array<{ userId: string; payload: any }>;
  let pushDeliveryService: PushDeliveryService;
  let webPushHandler: WebPushHandler;

  const player1 = new Player({
    id: 'user-player-1',
    email: 'p1@campus.edu',
    username: 'runner_one',
    displayName: 'Runner One',
    totalPoints: 150,
    seasonPoints: 75,
    rank: 1,
    tier: 'bronze',
    claimsCount: 3,
    currentStreakDays: 2,
    preferences: {
      pushNotificationsEnabled: true,
    },
    role: 'STUDENT',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  });

  const player2 = new Player({
    id: 'user-player-2',
    email: 'p2@campus.edu',
    username: 'runner_two',
    displayName: 'Runner Two',
    totalPoints: 80,
    seasonPoints: 40,
    rank: 2,
    tier: 'bronze',
    claimsCount: 1,
    currentStreakDays: 1,
    preferences: {
      pushNotificationsEnabled: false, // push disabled
    },
    role: 'STUDENT',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  });

  const subP1_Phone = new PushSubscription({
    id: 'sub-p1-phone',
    userId: 'user-player-1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/p1-phone',
    p256dh: 'p256dh_p1_phone',
    auth: 'auth_p1_phone',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const subP1_Laptop = new PushSubscription({
    id: 'sub-p1-laptop',
    userId: 'user-player-1',
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/p1-laptop',
    p256dh: 'p256dh_p1_laptop',
    auth: 'auth_p1_laptop',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const subP2_Device = new PushSubscription({
    id: 'sub-p2-device',
    userId: 'user-player-2',
    endpoint: 'https://fcm.googleapis.com/fcm/send/p2-device',
    p256dh: 'p256dh_p2_device',
    auth: 'auth_p2_device',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    pushRepo = new InMemoryPushSubscriptionRepository([
      new PushSubscription({ ...subP1_Phone.props }),
      new PushSubscription({ ...subP1_Laptop.props }),
      new PushSubscription({ ...subP2_Device.props }),
    ]);
    playerRepo = new InMemoryPlayerRepository([
      new Player({ ...player1.props }),
      new Player({ ...player2.props }),
    ]);

    deliveredPushes = [];

    const mockSender = async (sub: any, payload: string) => {
      const parsed = JSON.parse(payload);
      deliveredPushes.push({ userId: sub.endpoint, payload: parsed });
      return { statusCode: 201 };
    };

    pushDeliveryService = new PushDeliveryService(
      pushRepo,
      playerRepo,
      undefined,
      mockSender
    );

    webPushHandler = new WebPushHandler(
      eventBus,
      pushRepo,
      pushDeliveryService,
      playerRepo
    );
  });

  describe('1. Spawn Notification Handler (Rotation & Expiry)', () => {
    it('should dispatch spawn rotation push notification to eligible subscribed users', async () => {
      const event = new RotationTriggeredEvent({
        rotationId: 'rot-101',
        rotationNumber: 4,
        activatedSpawnCount: 8,
        expiresAt: new Date(Date.now() + 45 * 60000),
      });

      await eventBus.publish(event);

      // Player 1 has 2 devices and push enabled -> receives on both devices
      // Player 2 has push disabled -> skipped
      assert.equal(deliveredPushes.length, 2);
      const firstPush = deliveredPushes[0].payload;
      assert.equal(firstPush.title, 'New Spawns Available!');
      assert.match(firstPush.body, /8 new point drops/);
      assert.match(firstPush.body, /Rotation #4/);
      assert.equal(firstPush.data.type, 'SPAWN_ROTATED');
      assert.equal(firstPush.data.rotationNumber, 4);
    });

    it('should dispatch spawn expiry push notification on SpawnExpiredEvent', async () => {
      const event = new SpawnExpiredEvent({
        spawnIds: ['spawn-alpha', 'spawn-beta'],
        spawnId: 'spawn-alpha',
        spawnCode: 'LIB_01',
        reason: 'TIME_EXPIRED',
        expiredAt: new Date(),
      });

      await eventBus.publish(event);

      assert.equal(deliveredPushes.length, 2);
      const push = deliveredPushes[0].payload;
      assert.equal(push.title, 'Spawns Expired');
      assert.match(push.body, /LIB_01/);
      assert.equal(push.data.type, 'SPAWN_EXPIRED');
    });
  });

  describe('2. Claim Notification Handler', () => {
    it('should dispatch claim confirmation push notification strictly to claiming user', async () => {
      const event = new SpawnClaimedEvent({
        claimId: 'claim-xyz-99',
        spawnId: 'spawn-gym-01',
        spawnCode: 'GYM01',
        playerId: 'user-player-1',
        pointsAwarded: 150,
        playerLat: 12.97,
        playerLng: 77.59,
        zoneId: 'zone-gym',
      });

      await eventBus.publish(event);

      // Only delivered to player 1's 2 devices
      assert.equal(deliveredPushes.length, 2);
      const push = deliveredPushes[0].payload;
      assert.equal(push.title, 'Spawn Claimed!');
      assert.match(push.body, /GYM01/);
      assert.match(push.body, /\+150 points/);
      assert.equal(push.data.type, 'CLAIM_SUCCESS');
      assert.equal(push.data.claimId, 'claim-xyz-99');
      assert.equal(push.data.pointsAwarded, 150);
    });

    it('should respect user preferences and skip claim push when disabled by user', async () => {
      const event = new SpawnClaimedEvent({
        claimId: 'claim-disabled-user',
        spawnId: 'spawn-gym-02',
        spawnCode: 'GYM02',
        playerId: 'user-player-2', // has push disabled
        pointsAwarded: 50,
        playerLat: 12.97,
        playerLng: 77.59,
        zoneId: 'zone-gym',
      });

      await eventBus.publish(event);

      assert.equal(deliveredPushes.length, 0, 'No push should be sent when user disabled notifications');
    });
  });

  describe('3. Rank-Change Notification Handler', () => {
    it('should dispatch rank update push notification to the affected player', async () => {
      const event = new RankChangedEvent({
        playerId: 'user-player-1',
        username: 'runner_one',
        oldRank: 5,
        newRank: 1,
        points: 300,
        period: 'weekly',
        timestamp: new Date(),
      });

      await eventBus.publish(event);

      assert.equal(deliveredPushes.length, 2);
      const push = deliveredPushes[0].payload;
      assert.equal(push.title, 'Rank Updated!');
      assert.match(push.body, /#5 to #1/);
      assert.match(push.body, /300 points/);
      assert.equal(push.data.type, 'RANK_CHANGED');
      assert.equal(push.data.newRank, 1);
    });
  });

  describe('4. Reset Notification Handler (Approaching & Weekly Reset)', () => {
    it('should dispatch reset approaching push notification', async () => {
      const event = new ResetApproachingEvent({
        cycleId: 'cycle-wk-12',
        endsAt: new Date(Date.now() + 15 * 60000),
        minutesRemaining: 15,
        timestamp: new Date(),
      });

      await eventBus.publish(event);

      assert.equal(deliveredPushes.length, 2);
      const push = deliveredPushes[0].payload;
      assert.equal(push.title, 'Weekly Reset Approaching!');
      assert.match(push.body, /15 minutes/);
      assert.equal(push.data.type, 'RESET_APPROACHING');
      assert.equal(push.data.minutesRemaining, 15);
    });

    it('should dispatch weekly reset announcement push notification on LeaderboardResetEvent', async () => {
      const event = new LeaderboardResetEvent({
        cycleId: 'cycle-wk-12',
        resetKey: 'scheduled:cycle-wk-12',
        resetTimestamp: new Date(),
        period: 'weekly',
      });

      await eventBus.publish(event);

      assert.equal(deliveredPushes.length, 2);
      const push = deliveredPushes[0].payload;
      assert.equal(push.title, 'Weekly Leaderboard Reset');
      assert.match(push.body, /Scores have reset to 0/);
      assert.equal(push.data.type, 'WEEKLY_RESET');
    });
  });

  describe('5. Fault Tolerance & Unsubscribe', () => {
    it('should not throw or disrupt event bus if PushDeliveryService encounters transport failure', async () => {
      const failingSender = async () => {
        const err: any = new Error('Push service 500 error');
        err.statusCode = 500;
        throw err;
      };

      const failingDeliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        failingSender
      );

      const failingHandler = new WebPushHandler(
        eventBus,
        pushRepo,
        failingDeliveryService,
        playerRepo
      );

      await assert.doesNotReject(async () => {
        await eventBus.publish(
          new SpawnClaimedEvent({
            claimId: 'claim-err',
            spawnId: 'sp-1',
            spawnCode: 'SP01',
            playerId: 'user-player-1',
            pointsAwarded: 50,
            playerLat: 10,
            playerLng: 10,
            zoneId: 'z1',
          })
        );
      });

      failingHandler.unregister();
    });
  });
});
