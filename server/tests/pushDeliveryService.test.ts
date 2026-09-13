import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PushDeliveryService } from '../services/PushDeliveryService';
import { InMemoryPushSubscriptionRepository } from '../infrastructure/repositories/inmemory/InMemoryPushSubscriptionRepository';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { PushSubscription } from '../domain/entities/PushSubscription';
import { Player } from '../domain/entities/Player';

describe('PushDeliveryService - Core Web Push Delivery', () => {
  let pushRepo: InMemoryPushSubscriptionRepository;
  let playerRepo: InMemoryPlayerRepository;

  const playerWithPushEnabled = new Player({
    id: 'user-push-enabled',
    email: 'enabled@campus.edu',
    username: 'push_enabled_user',
    totalPoints: 100,
    seasonPoints: 50,
    rank: 1,
    tier: 'bronze',
    claimsCount: 2,
    currentStreakDays: 1,
    preferences: {
      soundEnabled: true,
      pushNotificationsEnabled: true,
    },
    role: 'STUDENT',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  });

  const playerWithPushDisabled = new Player({
    id: 'user-push-disabled',
    email: 'disabled@campus.edu',
    username: 'push_disabled_user',
    totalPoints: 200,
    seasonPoints: 100,
    rank: 2,
    tier: 'silver',
    claimsCount: 4,
    currentStreakDays: 2,
    preferences: {
      soundEnabled: true,
      pushNotificationsEnabled: false,
    },
    role: 'STUDENT',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  });

  const subUser1_Desktop = new PushSubscription({
    id: 'sub-enabled-desktop',
    userId: 'user-push-enabled',
    endpoint: 'https://fcm.googleapis.com/fcm/send/token-desktop',
    p256dh: 'sample_p256dh_desktop',
    auth: 'sample_auth_desktop',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const subUser1_Mobile = new PushSubscription({
    id: 'sub-enabled-mobile',
    userId: 'user-push-enabled',
    endpoint: 'https://fcm.googleapis.com/fcm/send/token-mobile',
    p256dh: 'sample_p256dh_mobile',
    auth: 'sample_auth_mobile',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const subUser2_Device = new PushSubscription({
    id: 'sub-disabled-device',
    userId: 'user-push-disabled',
    endpoint: 'https://fcm.googleapis.com/fcm/send/token-disabled',
    p256dh: 'sample_p256dh_disabled',
    auth: 'sample_auth_disabled',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    pushRepo = new InMemoryPushSubscriptionRepository([
      new PushSubscription({ ...subUser1_Desktop.props }),
      new PushSubscription({ ...subUser1_Mobile.props }),
      new PushSubscription({ ...subUser2_Device.props }),
    ]);

    playerRepo = new InMemoryPlayerRepository([
      new Player({ ...playerWithPushEnabled.props }),
      new Player({ ...playerWithPushDisabled.props }),
    ]);
  });

  describe('1. Successful Delivery to User Subscriptions', () => {
    it('should deliver notification to all subscriptions of a target user', async () => {
      const delivered: Array<{ endpoint: string; payload: string }> = [];

      const mockSender = async (sub: any, payload: string) => {
        delivered.push({ endpoint: sub.endpoint, payload });
        return { statusCode: 201 };
      };

      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        {
          vapidSubject: 'mailto:admin@campus.edu',
          vapidPublicKey: 'test-public-key',
          vapidPrivateKey: 'test-private-key',
        },
        mockSender
      );

      const payload = {
        title: 'New Spawn Drop!',
        body: 'A golden spawn appeared nearby!',
      };

      const result = await deliveryService.sendToUser('user-push-enabled', payload);

      assert.equal(result.skipped, false);
      assert.equal(result.totalSubscriptions, 2);
      assert.equal(result.successfulDeliveries, 2);
      assert.equal(result.failedDeliveries, 0);
      assert.equal(delivered.length, 2);
      assert.ok(delivered.some((d) => d.endpoint === subUser1_Desktop.endpoint));
      assert.ok(delivered.some((d) => d.endpoint === subUser1_Mobile.endpoint));
      assert.equal(JSON.parse(delivered[0].payload).title, 'New Spawn Drop!');
    });
  });

  describe('2. User Notification Preference Guard', () => {
    it('should skip sending and return skipped=true when user has push notifications disabled', async () => {
      let callCount = 0;
      const mockSender = async () => {
        callCount++;
        return { statusCode: 201 };
      };

      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        mockSender
      );

      const result = await deliveryService.sendToUser('user-push-disabled', {
        title: 'Weekly Reset',
        body: 'Leaderboard reset!',
      });

      assert.equal(result.skipped, true);
      assert.equal(result.skipReason, 'push_disabled_by_user_preference');
      assert.equal(result.totalSubscriptions, 0);
      assert.equal(result.successfulDeliveries, 0);
      assert.equal(callCount, 0, 'Sender should not have been called');
    });

    it('should support alternative preference key conventions (pushNotifications: false, notificationsEnabled: false)', async () => {
      const playerWithAltPref = new Player({
        id: 'user-alt-pref',
        email: 'alt@campus.edu',
        username: 'alt_pref_user',
        totalPoints: 10,
        seasonPoints: 10,
        rank: 3,
        tier: 'bronze',
        claimsCount: 1,
        currentStreakDays: 1,
        preferences: {
          pushEnabled: false,
        },
        role: 'STUDENT',
        createdAt: new Date(),
        lastActiveAt: new Date(),
      });

      await playerRepo.save(playerWithAltPref);
      await pushRepo.saveOrUpdate(
        new PushSubscription({
          id: 'sub-alt',
          userId: 'user-alt-pref',
          endpoint: 'https://example.com/sub-alt',
          p256dh: 'k',
          auth: 'a',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );

      const deliveryService = new PushDeliveryService(pushRepo, playerRepo);
      const isEnabled = await deliveryService.isPushEnabledForUser('user-alt-pref');
      assert.equal(isEnabled, false);

      const sendResult = await deliveryService.sendToUser('user-alt-pref', { title: 'Hi' });
      assert.equal(sendResult.skipped, true);
    });
  });

  describe('3. Automatic Removal of Invalid Subscriptions (404/410)', () => {
    it('should remove subscription when push service returns HTTP 410 Gone', async () => {
      const mockSender = async (sub: any) => {
        if (sub.endpoint === subUser1_Desktop.endpoint) {
          const error: any = new Error('Push subscription has unsubscribed or expired');
          error.statusCode = 410;
          throw error;
        }
        return { statusCode: 201 };
      };

      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        mockSender
      );

      const result = await deliveryService.sendToUser('user-push-enabled', {
        title: 'Claim Update',
      });

      assert.equal(result.successfulDeliveries, 1);
      assert.equal(result.failedDeliveries, 1);
      assert.ok(result.removedEndpoints.includes(subUser1_Desktop.endpoint));

      // Verify expired desktop subscription was deleted from repository
      const desktopSubAfter = await pushRepo.findByEndpoint(subUser1_Desktop.endpoint);
      assert.equal(desktopSubAfter, null, 'Expired subscription should be removed from database');

      // Verify mobile subscription remains intact
      const mobileSubAfter = await pushRepo.findByEndpoint(subUser1_Mobile.endpoint);
      assert.ok(mobileSubAfter, 'Active mobile subscription should remain intact');
    });

    it('should remove subscription when push service returns HTTP 404 Not Found', async () => {
      const mockSender = async () => {
        const error: any = new Error('Not Found');
        error.statusCode = 404;
        throw error;
      };

      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        mockSender
      );

      const singleSub = await pushRepo.findByEndpoint(subUser1_Mobile.endpoint);
      assert.ok(singleSub);

      const res = await deliveryService.sendToSubscription(singleSub, 'test payload');
      assert.equal(res.success, false);
      assert.equal(res.removed, true);

      const after = await pushRepo.findByEndpoint(subUser1_Mobile.endpoint);
      assert.equal(after, null);
    });
  });

  describe('4. Fault Isolation & Error Handling', () => {
    it('should not block delivery to other subscriptions when one subscription throws a 500 server error', async () => {
      const mockSender = async (sub: any) => {
        if (sub.endpoint === subUser1_Desktop.endpoint) {
          const error: any = new Error('FCM Internal Server Error 500');
          error.statusCode = 500;
          throw error;
        }
        return { statusCode: 201 };
      };

      const deliveryService = new PushDeliveryService(
        pushRepo,
        playerRepo,
        undefined,
        mockSender
      );

      const result = await deliveryService.sendToUser('user-push-enabled', {
        title: 'Rank Changed',
      });

      assert.equal(result.totalSubscriptions, 2);
      assert.equal(result.successfulDeliveries, 1);
      assert.equal(result.failedDeliveries, 1);
      assert.equal(result.removedEndpoints.length, 0, 'Transient 500 error should not delete subscription');

      // Both subscriptions still exist in repo
      assert.ok(await pushRepo.findByEndpoint(subUser1_Desktop.endpoint));
      assert.ok(await pushRepo.findByEndpoint(subUser1_Mobile.endpoint));
    });

    it('should handle invalid user ID and missing subscriptions gracefully without throwing', async () => {
      const deliveryService = new PushDeliveryService(pushRepo, playerRepo);

      const resEmpty = await deliveryService.sendToUser('', { title: 'Test' });
      assert.equal(resEmpty.skipped, true);

      const resNonExistent = await deliveryService.sendToUser('non-existent-user', { title: 'Test' });
      assert.equal(resNonExistent.totalSubscriptions, 0);
      assert.equal(resNonExistent.successfulDeliveries, 0);
    });
  });
});
