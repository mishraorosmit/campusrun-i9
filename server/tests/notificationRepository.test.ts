import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresNotificationRepository } from '../infrastructure/repositories/postgres/PostgresNotificationRepository';
import { InMemoryNotificationRepository } from '../infrastructure/repositories/inmemory/InMemoryNotificationRepository';
import { Notification } from '../domain/entities/Notification';

describe('Notification Database Schema & Base Repository', () => {
  describe('1. Notification Entity Data Fields & Entity References', () => {
    it('should create Notification entity with all required fields and entity references', () => {
      const now = new Date('2026-09-13T08:00:00.000Z');
      const notif = new Notification({
        id: 'notif-uuid-1',
        userId: 'user-uuid-1',
        type: 'claim_reward',
        title: 'Spawn Claimed!',
        body: 'You earned 100 points at Library Quad.',
        read: false,
        readAt: null,
        entityType: 'claim',
        entityId: 'claim-uuid-1',
        createdAt: now,
      });

      assert.equal(notif.id, 'notif-uuid-1');
      assert.equal(notif.userId, 'user-uuid-1');
      assert.equal(notif.type, 'claim_reward');
      assert.equal(notif.title, 'Spawn Claimed!');
      assert.equal(notif.body, 'You earned 100 points at Library Quad.');
      assert.equal(notif.read, false);
      assert.equal(notif.readAt, null);
      assert.equal(notif.entityType, 'claim');
      assert.equal(notif.entityId, 'claim-uuid-1');
      assert.equal(notif.createdAt, now);
    });

    it('should support markAsRead on Notification entity', () => {
      const notif = new Notification({
        id: 'notif-1',
        userId: 'user-1',
        type: 'spawn_rotation',
        title: 'New Spawns',
        body: 'Spawns rotated',
        read: false,
        createdAt: new Date(),
      });

      const readTime = new Date('2026-09-13T08:05:00.000Z');
      const updated = notif.markAsRead(readTime);

      assert.equal(updated.read, true);
      assert.equal(updated.readAt, readTime);
      assert.equal(updated.id, notif.id);
      assert.equal(updated.title, notif.title);
    });
  });

  describe('2. PostgresNotificationRepository Base Persistence', () => {
    it('should execute save(notification) with correct SQL parameters including entity_type and entity_id', async () => {
      let executedQuery = '';
      let executedValues: any[] = [];

      const mockPool = {
        query: async (sql: string, values: any[]) => {
          executedQuery = sql;
          executedValues = values;
          return { rowCount: 1, rows: [] };
        },
      };

      const repo = new PostgresNotificationRepository(mockPool);
      const notifDate = new Date('2026-09-13T08:00:00.000Z');

      const notif = new Notification({
        id: 'notif-test-101',
        userId: 'user-test-202',
        type: 'leaderboard_rank',
        title: 'Rank Updated',
        body: 'You reached rank #1!',
        read: false,
        readAt: null,
        entityType: 'leaderboard',
        entityId: 'cycle-wk-1',
        createdAt: notifDate,
      });

      await repo.save(notif);

      assert.ok(executedQuery.includes('INSERT INTO notifications'));
      assert.ok(executedQuery.includes('ON CONFLICT (id) DO UPDATE'));
      assert.equal(executedValues[0], 'notif-test-101');
      assert.equal(executedValues[1], 'user-test-202');
      assert.equal(executedValues[2], 'leaderboard_rank');
      assert.equal(executedValues[3], 'Rank Updated');
      assert.equal(executedValues[4], 'You reached rank #1!');
      assert.equal(executedValues[5], false);
      assert.equal(executedValues[6], null);
      assert.equal(executedValues[7], 'leaderboard');
      assert.equal(executedValues[8], 'cycle-wk-1');
      assert.equal(executedValues[9], notifDate);
    });

    it('should execute findById and map row correctly', async () => {
      const mockPool = {
        query: async (sql: string, values: any[]) => {
          assert.ok(sql.includes('WHERE id = $1'));
          assert.equal(values[0], 'notif-find-1');
          return {
            rowCount: 1,
            rows: [
              {
                id: 'notif-find-1',
                user_id: 'user-1',
                type: 'spawn_rotation',
                title: 'New Spawns Available',
                body: 'Check your map!',
                read: false,
                read_at: null,
                entity_type: 'spawn',
                entity_id: 'spawn-01',
                created_at: new Date('2026-09-13T08:00:00.000Z').toISOString(),
              },
            ],
          };
        },
      };

      const repo = new PostgresNotificationRepository(mockPool);
      const found = await repo.findById('notif-find-1');

      assert.ok(found);
      assert.equal(found.id, 'notif-find-1');
      assert.equal(found.entityType, 'spawn');
      assert.equal(found.entityId, 'spawn-01');
      assert.equal(found.read, false);
    });

    it('should execute findByUserId with pagination and ordering', async () => {
      let executedQuery = '';
      let executedValues: any[] = [];

      const mockPool = {
        query: async (sql: string, values: any[]) => {
          executedQuery = sql;
          executedValues = values;
          return {
            rowCount: 1,
            rows: [
              {
                id: 'notif-u1',
                user_id: values[0],
                type: 'claim_reward',
                title: 'Claimed',
                body: 'Points added',
                read: false,
                read_at: null,
                entity_type: 'claim',
                entity_id: 'claim-1',
                created_at: new Date().toISOString(),
              },
            ],
          };
        },
      };

      const repo = new PostgresNotificationRepository(mockPool);
      const results = await repo.findByUserId('user-1', 25, 10);

      assert.ok(executedQuery.includes('WHERE user_id = $1'));
      assert.ok(executedQuery.includes('ORDER BY created_at DESC'));
      assert.ok(executedQuery.includes('LIMIT $2 OFFSET $3'));
      assert.equal(executedValues[0], 'user-1');
      assert.equal(executedValues[1], 25);
      assert.equal(executedValues[2], 10);
      assert.equal(results.length, 1);
    });

    it('should execute markAsRead and return updated entity', async () => {
      const mockPool = {
        query: async (sql: string, values: any[]) => {
          assert.ok(sql.includes('UPDATE notifications'));
          assert.ok(sql.includes('SET read = true'));
          assert.ok(sql.includes('WHERE id = $1 AND user_id = $2'));
          return {
            rowCount: 1,
            rows: [
              {
                id: values[0],
                user_id: values[1],
                type: 'spawn_rotation',
                title: 'New Spawns',
                body: 'Drops spawned',
                read: true,
                read_at: new Date().toISOString(),
                entity_type: 'spawn',
                entity_id: 'spawn-1',
                created_at: new Date().toISOString(),
              },
            ],
          };
        },
      };

      const repo = new PostgresNotificationRepository(mockPool);
      const updated = await repo.markAsRead('notif-1', 'user-1');

      assert.ok(updated);
      assert.equal(updated.read, true);
      assert.ok(updated.readAt);
    });
  });

  describe('3. InMemoryNotificationRepository Base Persistence', () => {
    it('should save and retrieve notification records in memory', async () => {
      const repo = new InMemoryNotificationRepository();
      const notif = new Notification({
        id: 'mem-notif-1',
        userId: 'mem-user-1',
        type: 'system_announcement',
        title: 'Welcome',
        body: 'Welcome to Campus Run',
        read: false,
        createdAt: new Date(),
      });

      await repo.save(notif);

      const found = await repo.findById('mem-notif-1');
      assert.ok(found);
      assert.equal(found.id, 'mem-notif-1');
      assert.equal(found.userId, 'mem-user-1');
    });
  });
});
