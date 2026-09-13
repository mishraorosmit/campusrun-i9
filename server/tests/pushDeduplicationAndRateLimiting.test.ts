import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PushDeliveryService } from '../services/PushDeliveryService';
import { InMemoryPushSubscriptionRepository } from '../infrastructure/repositories/inmemory/InMemoryPushSubscriptionRepository';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { PushSubscription } from '../domain/entities/PushSubscription';
import { Player } from '../domain/entities/Player';
import { InMemoryEventBus } from '../events/EventBus';
import { WebPushHandler } from '../events/handlers/WebPushHandler';
import { SpawnClaimedEvent, RotationTriggeredEvent } from '../domain/events';

describe('Web Push Deduplication and Spam Prevention', () => {
  let pushRepo: InMemoryPushSubscriptionRepository;
  let playerRepo: InMemoryPlayerRepository;
  let sentDispatches: Array<{ endpoint: string; payload: any }>;

  const playerA = new Player({
    id: 'user-dedup-a',
    email: 'a@campus.edu',
    username: 'user_a',
    totalPoints: 100,
    seasonPoints: 50,
    rank: 1,
    tier: 'bronze',
    claimsCount: 2,
    currentStreakDays: 1,
    preferences: { pushNotificationsEnabled: true },
    role: 'STUDENT',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  });

  const playerB = new Player({
    id: 'user-dedup-b',
    email: 'b@campus.edu',
    username: 'user_b',
    totalPoints: 200,
    seasonPoints: 100,
    rank: 2,
    tier: 'silver',
    claimsCount: 4,
    currentStreakDays: 2,
    preferences: { pushNotificationsEnabled: true },
    role: 'STUDENT',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  });

  const subUserA = new PushSubscription({
    id: 'sub-user-a',
    userId: 'user-dedup-a',
    endpoint: 'https://fcm.googleapis.com/fcm/send/token-user-a',
    p256dh: 'p256dh_a',
    auth: 'auth_a',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const subUserB = new PushSubscription({
    id: 'sub-user-b',
    userId: 'user-dedup-b',
    endpoint: 'https://fcm.googleapis.com/fcm/send/token-user-b',
    p256dh: 'p256dh_b',
    auth: 'auth_b',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    pushRepo = new InMemoryPushSubscriptionRepository([
      new PushSubscription({ ...subUserA.props }),
      new PushSubscription({ ...subUserB.props }),
    ]);
    playerRepo = new InMemoryPlayerRepository([
      new Player({ ...playerA.props }),
      new Player({ ...playerB.props }),
    ]);

    sentDispatches = [];
  });

  const createTestSender = () => {
    return async (sub: any, payload: string) => {
      sentDispatches.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    };
  };

  describe('1. Deduplication (Same User + Same Event Type + Same Entity)', () => {
    it('should allow first notification and suppress duplicate notification within dedup window', async () => {
      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        createTestSender(),
        { dedupWindowMs: 5000, maxNotificationsPerWindow: 10 }
      );

      const claimPayload = {
        title: 'Spawn Claimed!',
        body: 'You claimed LIB01 and earned +100 points!',
        data: {
          type: 'CLAIM_SUCCESS',
          claimId: 'claim-101',
          spawnId: 'spawn-lib',
          pointsAwarded: 100,
        },
      };

      // First send -> succeeds
      const result1 = await deliveryService.sendToUser('user-dedup-a', claimPayload);
      assert.equal(result1.skipped, false);
      assert.equal(result1.successfulDeliveries, 1);
      assert.equal(sentDispatches.length, 1);

      // Second immediate send (same user + same event CLAIM_SUCCESS + same claimId claim-101) -> suppressed
      const result2 = await deliveryService.sendToUser('user-dedup-a', claimPayload);
      assert.equal(result2.skipped, true);
      assert.equal(result2.skipReason, 'duplicate_suppressed');
      assert.equal(result2.successfulDeliveries, 0);
      assert.equal(sentDispatches.length, 1, 'Push should not have been dispatched twice');
    });

    it('should allow same event type with a different entity ID to the same user', async () => {
      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        createTestSender(),
        { dedupWindowMs: 5000, maxNotificationsPerWindow: 10 }
      );

      const claim1 = {
        title: 'Spawn Claimed!',
        data: { type: 'CLAIM_SUCCESS', claimId: 'claim-101' },
      };
      const claim2 = {
        title: 'Spawn Claimed!',
        data: { type: 'CLAIM_SUCCESS', claimId: 'claim-102' },
      };

      const res1 = await deliveryService.sendToUser('user-dedup-a', claim1);
      const res2 = await deliveryService.sendToUser('user-dedup-a', claim2);

      assert.equal(res1.skipped, false);
      assert.equal(res2.skipped, false);
      assert.equal(sentDispatches.length, 2);
    });

    it('should allow the same event and entity to a different user without deduplication conflict', async () => {
      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        createTestSender(),
        { dedupWindowMs: 5000, maxNotificationsPerWindow: 10 }
      );

      const rotationPayload = {
        title: 'New Spawns Available!',
        data: { type: 'SPAWN_ROTATED', rotationNumber: 10 },
      };

      const resUserA = await deliveryService.sendToUser('user-dedup-a', rotationPayload);
      const resUserB = await deliveryService.sendToUser('user-dedup-b', rotationPayload);

      assert.equal(resUserA.skipped, false);
      assert.equal(resUserB.skipped, false);
      assert.equal(sentDispatches.length, 2);
    });
  });

  describe('2. Per-User Rolling Rate Limiting', () => {
    it('should throttle and prevent spam when notifications exceed rate limit in rolling window', async () => {
      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        createTestSender(),
        {
          dedupWindowMs: 1000,
          rateLimitWindowMs: 60_000,
          maxNotificationsPerWindow: 3, // allow max 3 notifications per user
        }
      );

      // Send 3 distinct notifications to User A
      for (let i = 1; i <= 3; i++) {
        const res = await deliveryService.sendToUser('user-dedup-a', {
          title: `Notification ${i}`,
          data: { type: 'CLAIM_SUCCESS', claimId: `claim-unique-${i}` },
        });
        assert.equal(res.skipped, false);
      }

      assert.equal(sentDispatches.length, 3);

      // 4th notification exceeds rate limit -> rate limited
      const res4 = await deliveryService.sendToUser('user-dedup-a', {
        title: 'Notification 4',
        data: { type: 'CLAIM_SUCCESS', claimId: 'claim-unique-4' },
      });

      assert.equal(res4.skipped, true);
      assert.equal(res4.skipReason, 'rate_limited');
      assert.equal(sentDispatches.length, 3, '4th notification should be blocked by rate limiter');

      // User B should NOT be rate limited
      const resUserB = await deliveryService.sendToUser('user-dedup-b', {
        title: 'Notification for User B',
        data: { type: 'CLAIM_SUCCESS', claimId: 'claim-user-b' },
      });
      assert.equal(resUserB.skipped, false);
      assert.equal(sentDispatches.length, 4);
    });
  });

  describe('3. Deduplication & Rate Limit State Cleanup (Bounded Memory)', () => {
    it('should prune expired entries and allow re-sending after dedup window has elapsed', () => {
      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        createTestSender(),
        { dedupWindowMs: 2000, rateLimitWindowMs: 5000, maxNotificationsPerWindow: 5 }
      );

      const dedupKey = 'dedup:user-1:CLAIM_SUCCESS:claim-1';
      const t0 = 1000000;

      // Manually test with timestamp t0
      assert.equal(deliveryService.isDuplicate(dedupKey, t0), false);

      // Simulate sending at t0
      (deliveryService as any).recordDelivery('user-1', dedupKey, t0);

      // Within window (t0 + 1000ms) -> duplicate
      assert.equal(deliveryService.isDuplicate(dedupKey, t0 + 1000), true);

      // After window expired (t0 + 2500ms) -> not duplicate & prune cleans it up
      deliveryService.pruneExpiredEntries(t0 + 2500);
      assert.equal(deliveryService.isDuplicate(dedupKey, t0 + 2500), false);
    });

    it('should prune expired timestamps from rate limiter store', () => {
      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        createTestSender(),
        { dedupWindowMs: 1000, rateLimitWindowMs: 3000, maxNotificationsPerWindow: 2 }
      );

      const t0 = 2000000;

      (deliveryService as any).recordDelivery('user-1', 'k1', t0);
      (deliveryService as any).recordDelivery('user-1', 'k2', t0 + 500);

      assert.equal(deliveryService.isRateLimited('user-1', t0 + 1000), true);

      // After rolling window passes (t0 + 3500) -> timestamps are pruned and user is not rate limited
      deliveryService.pruneExpiredEntries(t0 + 3500);
      assert.equal(deliveryService.isRateLimited('user-1', t0 + 3500), false);
    });
  });

  describe('4. EventBus Fan-Out Integration with Deduplication & Rate Limiting', () => {
    it('should automatically deduplicate repeated domain events published to EventBus', async () => {
      const eventBus = new InMemoryEventBus();
      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        createTestSender(),
        { dedupWindowMs: 5000 }
      );

      const handler = new WebPushHandler(eventBus, pushRepo, deliveryService, playerRepo);

      const claimEvent = new SpawnClaimedEvent({
        claimId: 'claim-bus-dup-1',
        spawnId: 'sp-1',
        spawnCode: 'CODE1',
        playerId: 'user-dedup-a',
        pointsAwarded: 50,
        playerLat: 10,
        playerLng: 10,
        zoneId: 'z1',
      });

      // Publish event once -> delivered
      await eventBus.publish(claimEvent);
      assert.equal(sentDispatches.length, 1);

      // Publish identical event a second time immediately -> suppressed by push delivery deduplication
      await eventBus.publish(claimEvent);
      assert.equal(sentDispatches.length, 1, 'Duplicate event must not produce second push notification');

      handler.unregister();
    });
  });
});
