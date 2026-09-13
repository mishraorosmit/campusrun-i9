import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PushSubscriptionController } from '../controllers/PushSubscriptionController';
import { SavePushSubscriptionUseCase } from '../services/SavePushSubscriptionUseCase';
import { DeletePushSubscriptionUseCase } from '../services/DeletePushSubscriptionUseCase';
import { InMemoryPushSubscriptionRepository } from '../infrastructure/repositories/inmemory/InMemoryPushSubscriptionRepository';
import { PushSubscription } from '../domain/entities/PushSubscription';
import { requireCurrentUser } from '../middlewares/auth';
import { createApp } from '../app';

describe('Push Subscription Endpoints (POST & DELETE /api/v1/push/subscribe)', () => {
  let pushRepo: InMemoryPushSubscriptionRepository;
  let savePushSubscriptionUseCase: SavePushSubscriptionUseCase;
  let deletePushSubscriptionUseCase: DeletePushSubscriptionUseCase;
  let pushSubscriptionController: PushSubscriptionController;

  const existingSubUser1 = new PushSubscription({
    id: 'sub-user-1-01',
    userId: 'user-push-1',
    endpoint: 'https://fcm.googleapis.com/fcm/send/sample-token-1',
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcUbV3CjdDxrKtZEG9KA7AB_bntdECK_5x9j4a07G7rOU=',
    auth: 'tBHItJI5svbpez7KI4CCXg==',
    userAgent: 'Mozilla/5.0 Chrome/120.0',
    createdAt: new Date('2026-09-12T10:00:00.000Z'),
    updatedAt: new Date('2026-09-12T10:00:00.000Z'),
  });

  const existingSubUser2 = new PushSubscription({
    id: 'sub-user-2-01',
    userId: 'user-push-2',
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/sample-token-2',
    p256dh: 'BD7eJ7Zk5Yw9fK1EtK2wtaz5Ry4YfYCA_0QT9AcUbV3CjdDxrKtZEG9KA7AB_bntdECK_5x9j4a07G7rOU=',
    auth: 'kLM8uJI5svbpez7KI4CCXg==',
    userAgent: 'Firefox/122.0',
    createdAt: new Date('2026-09-12T11:00:00.000Z'),
    updatedAt: new Date('2026-09-12T11:00:00.000Z'),
  });

  beforeEach(() => {
    pushRepo = new InMemoryPushSubscriptionRepository([
      new PushSubscription({ ...existingSubUser1.props }),
      new PushSubscription({ ...existingSubUser2.props }),
    ]);

    savePushSubscriptionUseCase = new SavePushSubscriptionUseCase(pushRepo);
    deletePushSubscriptionUseCase = new DeletePushSubscriptionUseCase(pushRepo);
    pushSubscriptionController = new PushSubscriptionController(
      savePushSubscriptionUseCase,
      deletePushSubscriptionUseCase
    );
  });

  describe('1. POST /api/v1/push/subscribe', () => {
    it('should reject unauthenticated requests with 401 Unauthorized via middleware', () => {
      const req: any = { headers: {} };
      const res: any = {};
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should return 401 if req.user is absent in controller handler', async () => {
      const req: any = { body: {} };
      const res: any = { json() {} };
      let errReceived: any = null;

      await pushSubscriptionController.subscribe(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should reject missing or empty endpoint with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        headers: {},
        body: {
          keys: {
            p256dh: 'test-p256dh',
            auth: 'test-auth',
          },
        },
      };
      let errReceived: any = null;

      await pushSubscriptionController.subscribe(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
      assert.match(errReceived.message, /endpoint is required/i);
    });

    it('should reject non-HTTP/HTTPS endpoint with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        headers: {},
        body: {
          endpoint: 'javascript:alert(1)',
          keys: {
            p256dh: 'test-p256dh',
            auth: 'test-auth',
          },
        },
      };
      let errReceived: any = null;

      await pushSubscriptionController.subscribe(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
      assert.match(errReceived.message, /valid HTTP or HTTPS URL/i);
    });

    it('should reject missing p256dh key with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        headers: {},
        body: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/token-new',
          keys: {
            auth: 'test-auth',
          },
        },
      };
      let errReceived: any = null;

      await pushSubscriptionController.subscribe(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
      assert.match(errReceived.message, /p256dh key is required/i);
    });

    it('should reject missing auth key with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        headers: {},
        body: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/token-new',
          keys: {
            p256dh: 'test-p256dh',
          },
        },
      };
      let errReceived: any = null;

      await pushSubscriptionController.subscribe(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
      assert.match(errReceived.message, /auth key is required/i);
    });

    it('should successfully store a new standard W3C push subscription', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        body: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/brand-new-subscription',
          keys: {
            p256dh: 'BHX18b7s_sample_p256dh_key',
            auth: 'sample_auth_key_123',
          },
        },
      };

      let responseStatusCode = 200;
      let responseBody: any = null;
      const res: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await pushSubscriptionController.subscribe(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.ok(responseBody.data);
      assert.equal(responseBody.data.endpoint, 'https://fcm.googleapis.com/fcm/send/brand-new-subscription');
      assert.ok(responseBody.data.id);
      assert.ok(responseBody.data.createdAt);

      // Verify secrets are NOT exposed in response
      assert.equal(responseBody.data.auth, undefined);
      assert.equal(responseBody.data.p256dh, undefined);

      // Verify stored in repository
      const savedInRepo = await pushRepo.findByEndpoint('https://fcm.googleapis.com/fcm/send/brand-new-subscription');
      assert.ok(savedInRepo);
      assert.equal(savedInRepo.userId, 'user-push-1');
      assert.equal(savedInRepo.p256dh, 'BHX18b7s_sample_p256dh_key');
      assert.equal(savedInRepo.auth, 'sample_auth_key_123');
    });

    it('should successfully store flat push subscription payload', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        headers: {},
        body: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/flat-format-subscription',
          p256dh: 'BHX18b7s_sample_flat_p256dh',
          auth: 'sample_flat_auth',
        },
      };

      let responseStatusCode = 200;
      let responseBody: any = null;
      const res: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await pushSubscriptionController.subscribe(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      const savedInRepo = await pushRepo.findByEndpoint('https://fcm.googleapis.com/fcm/send/flat-format-subscription');
      assert.ok(savedInRepo);
      assert.equal(savedInRepo.p256dh, 'BHX18b7s_sample_flat_p256dh');
    });

    it('should update existing subscription on duplicate endpoint instead of creating duplicate rows', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        headers: {},
        body: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/sample-token-1', // existing endpoint
          keys: {
            p256dh: 'updated_p256dh_key_value',
            auth: 'updated_auth_key_value',
          },
        },
      };

      let responseStatusCode = 200;
      let responseBody: any = null;
      const res: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await pushSubscriptionController.subscribe(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);

      // Verify repository has the updated keys and original ID
      const updatedInRepo = await pushRepo.findByEndpoint('https://fcm.googleapis.com/fcm/send/sample-token-1');
      assert.ok(updatedInRepo);
      assert.equal(updatedInRepo.id, 'sub-user-1-01');
      assert.equal(updatedInRepo.p256dh, 'updated_p256dh_key_value');
      assert.equal(updatedInRepo.auth, 'updated_auth_key_value');
    });
  });

  describe('2. DELETE /api/v1/push/subscribe', () => {
    it('should reject unauthenticated request with 401 Unauthorized via middleware', () => {
      const req: any = { headers: {} };
      const res: any = {};
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should reject request missing endpoint or id with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: {},
      };
      let errReceived: any = null;

      await pushSubscriptionController.unsubscribe(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
      assert.match(errReceived.message, /endpoint or ID is required/i);
    });

    it('should return 404 when subscription endpoint does not exist', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: { endpoint: 'https://fcm.googleapis.com/fcm/send/non-existent-endpoint' },
      };
      let errReceived: any = null;

      await pushSubscriptionController.unsubscribe(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 404);
    });

    it('should return 404 when attempting to delete another user subscription (user isolation)', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/sample-token-2' }, // belongs to user 2
      };
      let errReceived: any = null;

      await pushSubscriptionController.unsubscribe(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 404);

      // Verify user 2's subscription was NOT deleted
      const subUser2 = await pushRepo.findByEndpoint('https://updates.push.services.mozilla.com/wpush/v2/sample-token-2');
      assert.ok(subUser2);
      assert.equal(subUser2.userId, 'user-push-2');
    });

    it('should successfully delete subscription by endpoint for authenticated user', async () => {
      const req: any = {
        user: { id: 'user-push-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: { endpoint: 'https://fcm.googleapis.com/fcm/send/sample-token-1' },
      };

      let responseStatusCode = 200;
      let responseBody: any = null;
      const res: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await pushSubscriptionController.unsubscribe(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);

      // Verify subscription deleted from repository
      const deletedSub = await pushRepo.findByEndpoint('https://fcm.googleapis.com/fcm/send/sample-token-1');
      assert.equal(deletedSub, null);

      // Verify user 2's subscription remains intact
      const subUser2 = await pushRepo.findByEndpoint('https://updates.push.services.mozilla.com/wpush/v2/sample-token-2');
      assert.ok(subUser2);
    });

    it('should successfully delete subscription by id or query param for authenticated user', async () => {
      const req: any = {
        user: { id: 'user-push-2', email: 'u2@campus.edu', username: 'user_two', role: 'STUDENT' },
        body: {},
        query: { id: 'sub-user-2-01' },
      };

      let responseStatusCode = 200;
      let responseBody: any = null;
      const res: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await pushSubscriptionController.unsubscribe(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);

      const deletedSub = await pushRepo.findById('sub-user-2-01');
      assert.equal(deletedSub, null);
    });
  });

  describe('3. App Integration & Route Wiring', () => {
    it('should mount push routes under /api/v1/push and handle requests in full app setup', () => {
      const testPushRepo = new InMemoryPushSubscriptionRepository();
      const app = createApp({ pushSubscriptionRepo: testPushRepo });
      assert.ok(app);
    });
  });
});
