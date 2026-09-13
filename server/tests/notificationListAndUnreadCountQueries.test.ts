import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresNotificationRepository } from '../infrastructure/repositories/postgres/PostgresNotificationRepository';
import { InMemoryNotificationRepository } from '../infrastructure/repositories/inmemory/InMemoryNotificationRepository';
import { Notification } from '../domain/entities/Notification';
import { GetPlayerNotificationsUseCase } from '../services/GetPlayerNotificationsUseCase';
import { GetUnreadNotificationCountUseCase } from '../services/GetUnreadNotificationCountUseCase';

describe('Notification List and Unread-Count Queries', () => {
  let memoryRepo: InMemoryNotificationRepository;
  let getNotificationsUseCase: GetPlayerNotificationsUseCase;
  let getUnreadCountUseCase: GetUnreadNotificationCountUseCase;

  const notif1_U1_Unread = new Notification({
    id: 'n-u1-01',
    userId: 'user-alpha',
    type: 'spawn_rotation',
    title: 'New Spawns Available',
    body: '10 new spawns are active!',
    read: false,
    readAt: null,
    entityType: 'spawn',
    entityId: 'spawn-batch-1',
    createdAt: new Date('2026-09-13T08:00:00.000Z'), // newest
  });

  const notif2_U1_Unread = new Notification({
    id: 'n-u1-02',
    userId: 'user-alpha',
    type: 'claim_reward',
    title: 'Spawn Claimed',
    body: 'Earned +50 points!',
    read: false,
    readAt: null,
    entityType: 'claim',
    entityId: 'claim-101',
    createdAt: new Date('2026-09-13T07:30:00.000Z'),
  });

  const notif3_U1_Read = new Notification({
    id: 'n-u1-03',
    userId: 'user-alpha',
    type: 'leaderboard_rank',
    title: 'Rank Updated',
    body: 'You reached rank #1!',
    read: true,
    readAt: new Date('2026-09-13T07:10:00.000Z'),
    entityType: 'leaderboard',
    entityId: 'cycle-1',
    createdAt: new Date('2026-09-13T07:00:00.000Z'), // oldest
  });

  const notif1_U2_Unread = new Notification({
    id: 'n-u2-01',
    userId: 'user-beta',
    type: 'system_announcement',
    title: 'Welcome',
    body: 'Welcome to Campus Run!',
    read: false,
    readAt: null,
    entityType: null,
    entityId: null,
    createdAt: new Date('2026-09-13T08:10:00.000Z'),
  });

  beforeEach(() => {
    memoryRepo = new InMemoryNotificationRepository([
      new Notification({ ...notif1_U1_Unread.props }),
      new Notification({ ...notif2_U1_Unread.props }),
      new Notification({ ...notif3_U1_Read.props }),
      new Notification({ ...notif1_U2_Unread.props }),
    ]);

    getNotificationsUseCase = new GetPlayerNotificationsUseCase(memoryRepo);
    getUnreadCountUseCase = new GetUnreadNotificationCountUseCase(memoryRepo);
  });

  describe('1. getUnreadCount Database Query & Index Utilization', () => {
    it('should return exact unread count for the given user', async () => {
      const unreadCountAlpha = await memoryRepo.getUnreadCount('user-alpha');
      assert.equal(unreadCountAlpha, 2, 'user-alpha should have 2 unread notifications');

      const unreadCountBeta = await memoryRepo.getUnreadCount('user-beta');
      assert.equal(unreadCountBeta, 1, 'user-beta should have 1 unread notification');
    });

    it('should return 0 when all notifications are read or user has no notifications', async () => {
      await memoryRepo.markAsRead('n-u2-01', 'user-beta');
      const unreadBetaAfter = await memoryRepo.getUnreadCount('user-beta');
      assert.equal(unreadBetaAfter, 0);

      const unreadGamma = await memoryRepo.getUnreadCount('user-gamma');
      assert.equal(unreadGamma, 0);
    });

    it('should construct efficient SQL count query filtering by user_id and read = false in PostgresNotificationRepository', async () => {
      let executedSql = '';
      let executedParams: any[] = [];

      const mockPool = {
        query: async (sql: string, params: any[]) => {
          executedSql = sql;
          executedParams = params;
          return {
            rowCount: 1,
            rows: [{ unread_count: '5' }],
          };
        },
      };

      const postgresRepo = new PostgresNotificationRepository(mockPool);
      const count = await postgresRepo.getUnreadCount('user-pg-1');

      assert.equal(count, 5);
      assert.ok(executedSql.includes('SELECT COUNT(*)::int'));
      assert.ok(executedSql.includes('FROM notifications'));
      assert.ok(executedSql.includes('WHERE user_id = $1 AND read = false'));
      assert.deepEqual(executedParams, ['user-pg-1']);
    });
  });

  describe('2. findByUserId Notification List & Pagination Query', () => {
    it('should return notifications ordered chronologically by created_at DESC (newest first)', async () => {
      const list = await memoryRepo.findByUserId('user-alpha', 50, 0);

      assert.equal(list.length, 3);
      assert.equal(list[0].id, 'n-u1-01'); // 08:00
      assert.equal(list[1].id, 'n-u1-02'); // 07:30
      assert.equal(list[2].id, 'n-u1-03'); // 07:00
    });

    it('should support limit and offset pagination cleanly', async () => {
      // Page 1 (limit 2, offset 0)
      const page1 = await memoryRepo.findByUserId('user-alpha', 2, 0);
      assert.equal(page1.length, 2);
      assert.equal(page1[0].id, 'n-u1-01');
      assert.equal(page1[1].id, 'n-u1-02');

      // Page 2 (limit 2, offset 2)
      const page2 = await memoryRepo.findByUserId('user-alpha', 2, 2);
      assert.equal(page2.length, 1);
      assert.equal(page2[0].id, 'n-u1-03');
    });

    it('should construct SQL query with ORDER BY created_at DESC and LIMIT/OFFSET parameters', async () => {
      let executedSql = '';
      let executedParams: any[] = [];

      const mockPool = {
        query: async (sql: string, params: any[]) => {
          executedSql = sql;
          executedParams = params;
          return {
            rowCount: 1,
            rows: [
              {
                id: 'n-row-1',
                user_id: 'user-pg-1',
                type: 'spawn_rotation',
                title: 'New Drops',
                body: 'Available now',
                read: false,
                read_at: null,
                entity_type: 'spawn',
                entity_id: 'batch-01',
                created_at: new Date('2026-09-13T08:00:00.000Z').toISOString(),
              },
            ],
          };
        },
      };

      const postgresRepo = new PostgresNotificationRepository(mockPool);
      const list = await postgresRepo.findByUserId('user-pg-1', 20, 40);

      assert.ok(executedSql.includes('SELECT'));
      assert.ok(executedSql.includes('FROM notifications'));
      assert.ok(executedSql.includes('WHERE user_id = $1'));
      assert.ok(executedSql.includes('ORDER BY created_at DESC'));
      assert.ok(executedSql.includes('LIMIT $2 OFFSET $3'));
      assert.deepEqual(executedParams, ['user-pg-1', 20, 40]);

      assert.equal(list.length, 1);
      assert.equal(list[0].id, 'n-row-1');
      assert.equal(list[0].entityType, 'spawn');
      assert.equal(list[0].entityId, 'batch-01');
      assert.equal(list[0].read, false);
    });
  });

  describe('3. Clean Domain & DTO Mapping', () => {
    it('should map notification records to clean DTOs in GetPlayerNotificationsUseCase', async () => {
      const dtos = await getNotificationsUseCase.execute('user-alpha', 10, 0);

      assert.equal(dtos.length, 3);
      assert.equal(dtos[0].id, 'n-u1-01');
      assert.equal(dtos[0].userId, 'user-alpha');
      assert.equal(dtos[0].type, 'spawn_rotation');
      assert.equal(dtos[0].title, 'New Spawns Available');
      assert.equal(dtos[0].body, '10 new spawns are active!');
      assert.equal(dtos[0].read, false);
      assert.equal(dtos[0].readAt, null);
      assert.equal(dtos[0].entityType, 'spawn');
      assert.equal(dtos[0].entityId, 'spawn-batch-1');
      assert.equal(typeof dtos[0].createdAt, 'string');
    });

    it('should execute GetUnreadNotificationCountUseCase cleanly', async () => {
      const count = await getUnreadCountUseCase.execute('user-alpha');
      assert.equal(count, 2);
    });
  });
});
