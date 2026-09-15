import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SchemaValidator, PushSubscriptionSchema } from '../validation';
import { SavePushSubscriptionUseCase } from '../services/SavePushSubscriptionUseCase';
import { DeletePushSubscriptionUseCase } from '../services/DeletePushSubscriptionUseCase';
import { CleanupPushSubscriptionUseCase } from '../services/CleanupPushSubscriptionUseCase';
import { InMemoryPushSubscriptionRepository } from '../infrastructure/repositories/inmemory/InMemoryPushSubscriptionRepository';
import { PostgresPushSubscriptionRepository } from '../infrastructure/repositories/postgres/PostgresPushSubscriptionRepository';
import { PushSubscription } from '../domain/entities/PushSubscription';
import { ValidationError } from '../errors';

describe('Push Subscription Validation and Invalid-Subscription Cleanup', () => {
  let pushRepo: InMemoryPushSubscriptionRepository;
  let saveUseCase: SavePushSubscriptionUseCase;
  let deleteUseCase: DeletePushSubscriptionUseCase;
  let cleanupUseCase: CleanupPushSubscriptionUseCase;

  const validW3cPayload = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/sample-token-w3c-123',
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcUbV3CjdDxrKtZEG9KA7AB_bntdECK_5x9j4a07G7rOU=',
      auth: 'tBHItJI5svbpez7KI4CCXg==',
    },
  };

  const validFlatPayload = {
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/sample-token-flat-456',
    p256dh: 'BD7eJ7Zk5Yw9fK1EtK2wtaz5Ry4YfYCA_0QT9AcUbV3CjdDxrKtZEG9KA7AB_bntdECK_5x9j4a07G7rOU=',
    auth: 'kLM8uJI5svbpez7KI4CCXg==',
  };

  beforeEach(() => {
    pushRepo = new InMemoryPushSubscriptionRepository();
    saveUseCase = new SavePushSubscriptionUseCase(pushRepo);
    deleteUseCase = new DeletePushSubscriptionUseCase(pushRepo);
    cleanupUseCase = new CleanupPushSubscriptionUseCase(pushRepo);
  });

  describe('1. Schema Validation (PushSubscriptionSchema)', () => {
    it('should validate valid W3C nested payload with no issues', () => {
      const issues = SchemaValidator.validate(validW3cPayload, PushSubscriptionSchema);
      assert.equal(issues.length, 0);
    });

    it('should validate valid flat payload with no issues', () => {
      const issues = SchemaValidator.validate(validFlatPayload, PushSubscriptionSchema);
      assert.equal(issues.length, 0);
    });

    it('should report issue for missing or empty endpoint', () => {
      const payloadMissingEndpoint = {
        keys: { p256dh: 'key1', auth: 'auth1' },
      };
      const issues = SchemaValidator.validate(payloadMissingEndpoint, PushSubscriptionSchema);
      assert.ok(issues.some((i) => i.field === 'endpoint'));

      const payloadEmptyEndpoint = {
        endpoint: '   ',
        keys: { p256dh: 'key1', auth: 'auth1' },
      };
      const issues2 = SchemaValidator.validate(payloadEmptyEndpoint, PushSubscriptionSchema);
      assert.ok(issues2.some((i) => i.field === 'endpoint'));
    });

    it('should report issue for non-HTTP/HTTPS endpoint URLs', () => {
      const payloadBadProtocol = {
        endpoint: 'javascript:alert(document.cookie)',
        keys: { p256dh: 'key1', auth: 'auth1' },
      };
      const issues = SchemaValidator.validate(payloadBadProtocol, PushSubscriptionSchema);
      assert.ok(issues.some((i) => i.field === 'endpoint'));
    });

    it('should report issue for missing p256dh or auth keys', () => {
      const missingP256dh = {
        endpoint: 'https://example.com/push/1',
        keys: { auth: 'auth1' },
      };
      const issues1 = SchemaValidator.validate(missingP256dh, PushSubscriptionSchema);
      assert.ok(issues1.some((i) => i.field === 'keys'));

      const missingAuth = {
        endpoint: 'https://example.com/push/1',
        keys: { p256dh: 'p256dh1' },
      };
      const issues2 = SchemaValidator.validate(missingAuth, PushSubscriptionSchema);
      assert.ok(issues2.some((i) => i.field === 'auth'));
    });

    it('should report issue when keys are empty strings', () => {
      const emptyKeys = {
        endpoint: 'https://example.com/push/1',
        keys: { p256dh: '  ', auth: '  ' },
      };
      const issues = SchemaValidator.validate(emptyKeys, PushSubscriptionSchema);
      assert.ok(issues.length >= 1);
    });
  });

  describe('2. SavePushSubscriptionUseCase Validation Enforcement', () => {
    it('should reject malformed or incomplete payload with ValidationError', async () => {
      await assert.rejects(
        async () => {
          await saveUseCase.execute('user-1', { endpoint: 'not-a-url' } as any);
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    it('should successfully store valid subscription and return summary', async () => {
      const result = await saveUseCase.execute('user-1', validW3cPayload);
      assert.ok(result.id);
      assert.equal(result.endpoint, validW3cPayload.endpoint);

      const stored = await pushRepo.findByEndpoint(validW3cPayload.endpoint);
      assert.ok(stored);
      assert.equal(stored.userId, 'user-1');
      assert.equal(stored.p256dh, validW3cPayload.keys.p256dh);
      assert.equal(stored.auth, validW3cPayload.keys.auth);
    });
  });

  describe('3. Removing Subscriptions by Endpoint (Repository & Use Cases)', () => {
    beforeEach(async () => {
      await pushRepo.saveOrUpdate(
        new PushSubscription({
          id: 'sub-test-101',
          userId: 'user-alpha',
          endpoint: 'https://fcm.googleapis.com/fcm/send/active-token-1',
          p256dh: 'sample-p256dh',
          auth: 'sample-auth',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );
    });

    it('should remove subscription by endpoint in InMemory repository', async () => {
      const existsBefore = await pushRepo.findByEndpoint('https://fcm.googleapis.com/fcm/send/active-token-1');
      assert.ok(existsBefore);

      const removed = await pushRepo.deleteByEndpoint('https://fcm.googleapis.com/fcm/send/active-token-1');
      assert.equal(removed, true);

      const existsAfter = await pushRepo.findByEndpoint('https://fcm.googleapis.com/fcm/send/active-token-1');
      assert.equal(existsAfter, null);

      // Deleting again returns false
      const removedAgain = await pushRepo.deleteByEndpoint('https://fcm.googleapis.com/fcm/send/active-token-1');
      assert.equal(removedAgain, false);
    });

    it('should execute deleteByEndpoint via DeletePushSubscriptionUseCase', async () => {
      const removed = await deleteUseCase.deleteByEndpoint('https://fcm.googleapis.com/fcm/send/active-token-1');
      assert.equal(removed, true);

      const stored = await pushRepo.findByEndpoint('https://fcm.googleapis.com/fcm/send/active-token-1');
      assert.equal(stored, null);
    });

    it('should verify PostgresPushSubscriptionRepository.deleteByEndpoint query', async () => {
      let executedQuery = '';
      let executedValues: any[] = [];

      const mockPool = {
        query: async (sql: string, values: any[]) => {
          executedQuery = sql;
          executedValues = values;
          return { rowCount: 1, rows: [] };
        },
      };

      const postgresRepo = new PostgresPushSubscriptionRepository(mockPool);
      const res = await postgresRepo.deleteByEndpoint('https://example.com/expired-sub');

      assert.equal(res, true);
      assert.ok(executedQuery.includes('DELETE FROM push_subscriptions'));
      assert.ok(executedQuery.includes('WHERE endpoint = $1'));
      assert.deepEqual(executedValues, ['https://example.com/expired-sub']);
    });
  });

  describe('4. Cleanup of Invalid / Expired Push Subscriptions (CleanupPushSubscriptionUseCase)', () => {
    beforeEach(async () => {
      await pushRepo.saveOrUpdate(
        new PushSubscription({
          id: 'sub-test-expired',
          userId: 'user-beta',
          endpoint: 'https://fcm.googleapis.com/fcm/send/expired-token-999',
          p256dh: 'sample-p256dh',
          auth: 'sample-auth',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );
    });

    it('should detect RFC 8030 invalid/expired status codes (404 Not Found, 410 Gone)', () => {
      assert.equal(cleanupUseCase.isInvalidSubscriptionError(410), true);
      assert.equal(cleanupUseCase.isInvalidSubscriptionError(404), true);
      assert.equal(cleanupUseCase.isInvalidSubscriptionError(200), false);
      assert.equal(cleanupUseCase.isInvalidSubscriptionError(500), false);
      assert.equal(cleanupUseCase.isInvalidSubscriptionError(429), false);

      // Error objects
      assert.equal(cleanupUseCase.isInvalidSubscriptionError({ statusCode: 410 }), true);
      assert.equal(cleanupUseCase.isInvalidSubscriptionError({ status: 404 }), true);
      assert.equal(cleanupUseCase.isInvalidSubscriptionError(new Error('Received 410 Gone')), true);
      assert.equal(cleanupUseCase.isInvalidSubscriptionError(new Error('Network timeout')), false);
    });

    it('should remove expired subscription when cleanup is executed', async () => {
      const endpoint = 'https://fcm.googleapis.com/fcm/send/expired-token-999';
      const result = await cleanupUseCase.execute(endpoint, 'HTTP 410 Gone - Subscription Expired');

      assert.equal(result.removed, true);
      assert.equal(result.endpoint, endpoint);
      assert.equal(result.reason, 'HTTP 410 Gone - Subscription Expired');

      const remaining = await pushRepo.findByEndpoint(endpoint);
      assert.equal(remaining, null);
    });

    it('should cleanup only when error is recognized as invalid subscription', async () => {
      const endpoint = 'https://fcm.googleapis.com/fcm/send/expired-token-999';

      // Non-expired error (e.g. 500 Internal Server Error) -> no cleanup
      const noClean = await cleanupUseCase.cleanupIfInvalid(endpoint, 500);
      assert.equal(noClean, null);
      assert.ok(await pushRepo.findByEndpoint(endpoint));

      // Expired error (e.g. 410 Gone) -> triggers cleanup
      const cleaned = await cleanupUseCase.cleanupIfInvalid(endpoint, 410, 'expired_token');
      assert.ok(cleaned);
      assert.equal(cleaned.removed, true);
      assert.equal(await pushRepo.findByEndpoint(endpoint), null);
    });

    it('should throw ValidationError if cleanup is invoked without endpoint', async () => {
      await assert.rejects(
        async () => {
          await cleanupUseCase.execute('');
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });
  });
});
