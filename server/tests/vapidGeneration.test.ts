import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateVapidKeys, runVapidGenerationCLI } from '../scripts/generate-vapid';
import { PostgresPushSubscriptionRepository } from '../infrastructure/repositories/postgres/PostgresPushSubscriptionRepository';
import { PushSubscription } from '../domain/entities/PushSubscription';

describe('VAPID Credential Generation & PostgresPushSubscriptionRepository', () => {
  describe('1. VAPID Generation Utility', () => {
    it('should generate valid VAPID public and private key pair', () => {
      const keys = generateVapidKeys();

      assert.ok(keys.publicKey, 'Public key should be present');
      assert.ok(keys.privateKey, 'Private key should be present');
      assert.equal(typeof keys.publicKey, 'string');
      assert.equal(typeof keys.privateKey, 'string');

      // VAPID public key is uncompressed P-256 EC key encoded in base64url (around 87 chars)
      assert.ok(keys.publicKey.length > 50, 'Public key should have expected base64url length');
      // VAPID private key is 32-byte secret encoded in base64url (around 43 chars)
      assert.ok(keys.privateKey.length > 30, 'Private key should have expected base64url length');
      // Valid base64url characters only
      assert.match(keys.publicKey, /^[A-Za-z0-9_-]+$/);
      assert.match(keys.privateKey, /^[A-Za-z0-9_-]+$/);
    });

    it('should execute CLI runner cleanly and output keys', () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: any[]) => {
        logs.push(args.join(' '));
      };

      try {
        const keys = runVapidGenerationCLI();
        assert.ok(keys.publicKey);
        assert.ok(keys.privateKey);

        const joinedOutput = logs.join('\n');
        assert.match(joinedOutput, /VAPID_PUBLIC_KEY=/);
        assert.match(joinedOutput, /VAPID_PRIVATE_KEY=/);
        assert.match(joinedOutput, /VAPID_SUBJECT=/);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe('2. PostgresPushSubscriptionRepository', () => {
    it('should construct and execute saveOrUpdate with correct query and parameters', async () => {
      let executedQuery = '';
      let executedValues: any[] = [];

      const mockPool = {
        query: async (query: string, values: any[]) => {
          executedQuery = query;
          executedValues = values;
          return {
            rowCount: 1,
            rows: [
              {
                id: values[0],
                user_id: values[1],
                endpoint: values[2],
                p256dh: values[3],
                auth: values[4],
                user_agent: values[5],
                created_at: values[6].toISOString(),
                updated_at: values[7].toISOString(),
              },
            ],
          };
        },
      };

      const repo = new PostgresPushSubscriptionRepository(mockPool);
      const sub = new PushSubscription({
        id: 'sub-test-1',
        userId: 'user-test-1',
        endpoint: 'https://fcm.googleapis.com/fcm/send/token123',
        p256dh: 'test-p256dh-key',
        auth: 'test-auth-key',
        userAgent: 'TestBrowser/1.0',
        createdAt: new Date('2026-09-13T00:00:00.000Z'),
        updatedAt: new Date('2026-09-13T00:00:00.000Z'),
      });

      const result = await repo.saveOrUpdate(sub);

      assert.ok(executedQuery.includes('INSERT INTO push_subscriptions'));
      assert.ok(executedQuery.includes('ON CONFLICT (endpoint) DO UPDATE'));
      assert.equal(executedValues[0], 'sub-test-1');
      assert.equal(executedValues[1], 'user-test-1');
      assert.equal(executedValues[2], 'https://fcm.googleapis.com/fcm/send/token123');
      assert.equal(result.id, 'sub-test-1');
      assert.equal(result.userId, 'user-test-1');
      assert.equal(result.endpoint, 'https://fcm.googleapis.com/fcm/send/token123');
    });

    it('should construct and execute findByEndpoint', async () => {
      let executedQuery = '';
      let executedValues: any[] = [];

      const mockPool = {
        query: async (query: string, values: any[]) => {
          executedQuery = query;
          executedValues = values;
          return {
            rowCount: 1,
            rows: [
              {
                id: 'sub-test-endpoint',
                user_id: 'user-test-1',
                endpoint: values[0],
                p256dh: 'p256dh_val',
                auth: 'auth_val',
                user_agent: 'TestAgent',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        },
      };

      const repo = new PostgresPushSubscriptionRepository(mockPool);
      const result = await repo.findByEndpoint('https://example.com/push/123');

      assert.ok(executedQuery.includes('WHERE endpoint = $1'));
      assert.equal(executedValues[0], 'https://example.com/push/123');
      assert.ok(result);
      assert.equal(result.endpoint, 'https://example.com/push/123');
    });

    it('should return null when findByEndpoint or findById finds no row', async () => {
      const mockPool = {
        query: async () => ({ rowCount: 0, rows: [] }),
      };

      const repo = new PostgresPushSubscriptionRepository(mockPool);
      const byEndpoint = await repo.findByEndpoint('https://example.com/missing');
      const byId = await repo.findById('missing-id');

      assert.equal(byEndpoint, null);
      assert.equal(byId, null);
    });

    it('should construct and execute findByUserId', async () => {
      let executedQuery = '';
      let executedValues: any[] = [];

      const mockPool = {
        query: async (query: string, values: any[]) => {
          executedQuery = query;
          executedValues = values;
          return {
            rowCount: 2,
            rows: [
              {
                id: 'sub-1',
                user_id: values[0],
                endpoint: 'https://example.com/sub1',
                p256dh: 'k1',
                auth: 'a1',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              {
                id: 'sub-2',
                user_id: values[0],
                endpoint: 'https://example.com/sub2',
                p256dh: 'k2',
                auth: 'a2',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        },
      };

      const repo = new PostgresPushSubscriptionRepository(mockPool);
      const results = await repo.findByUserId('user-multi-sub');

      assert.ok(executedQuery.includes('WHERE user_id = $1'));
      assert.equal(executedValues[0], 'user-multi-sub');
      assert.equal(results.length, 2);
      assert.equal(results[0].id, 'sub-1');
      assert.equal(results[1].id, 'sub-2');
    });

    it('should construct and execute findAll', async () => {
      const mockPool = {
        query: async (query: string) => {
          return {
            rowCount: 1,
            rows: [
              {
                id: 'sub-all-1',
                user_id: 'u1',
                endpoint: 'https://example.com/sub1',
                p256dh: 'k1',
                auth: 'a1',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        },
      };

      const repo = new PostgresPushSubscriptionRepository(mockPool);
      const all = await repo.findAll();
      assert.equal(all.length, 1);
      assert.equal(all[0].id, 'sub-all-1');
    });

    it('should execute deleteByEndpointAndUserId and deleteByIdAndUserId with user isolation', async () => {
      const queries: { sql: string; values: any[] }[] = [];

      const mockPool = {
        query: async (sql: string, values: any[]) => {
          queries.push({ sql, values });
          return { rowCount: 1, rows: [] };
        },
      };

      const repo = new PostgresPushSubscriptionRepository(mockPool);
      const deletedByEndpoint = await repo.deleteByEndpointAndUserId('https://example.com/push/123', 'user-1');
      const deletedById = await repo.deleteByIdAndUserId('sub-id-123', 'user-1');

      assert.equal(deletedByEndpoint, true);
      assert.equal(deletedById, true);
      assert.ok(queries[0].sql.includes('WHERE endpoint = $1 AND user_id = $2'));
      assert.deepEqual(queries[0].values, ['https://example.com/push/123', 'user-1']);
      assert.ok(queries[1].sql.includes('WHERE id = $1 AND user_id = $2'));
      assert.deepEqual(queries[1].values, ['sub-id-123', 'user-1']);
    });
  });
});
