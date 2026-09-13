import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresNotificationRepository } from '../infrastructure/repositories/postgres/PostgresNotificationRepository';
import { InMemoryNotificationRepository } from '../infrastructure/repositories/inmemory/InMemoryNotificationRepository';
import { Notification } from '../domain/entities/Notification';
import { MarkNotificationReadUseCase } from '../services/MarkNotificationAsReadUseCase';
import { MarkAllNotificationsReadUseCase } from '../services/MarkAllNotificationsReadUseCase';
import { NotFoundError, ValidationError } from '../errors';

describe('Notification Read/Unread Status Management', () => {
  let memoryRepo: InMemoryNotificationRepository;
  let markSingleUseCase: MarkNotificationReadUseCase;
  let markAllUseCase: MarkAllNotificationsReadUseCase;

  const notif1_U1_Unread = new Notification({
    id: 'notif-u1-1',
    userId: 'user-alice',
    type: 'spawn_rotation',
    title: 'New Spawns Available',
    body: 'Spawns rotated',
    read: false,
    readAt: null,
    createdAt: new Date('2026-09-13T08:00:00.000Z'),
  });

  const notif2_U1_Unread = new Notification({
    id: 'notif-u1-2',
    userId: 'user-alice',
    type: 'claim_reward',
    title: 'Claim Confirmed',
    body: 'Earned 100 points',
    read: false,
    readAt: null,
    createdAt: new Date('2026-09-13T08:05:00.000Z'),
  });

  const notif3_U1_AlreadyRead = new Notification({
    id: 'notif-u1-3',
    userId: 'user-alice',
    type: 'leaderboard_rank',
    title: 'Rank 1',
    body: 'Rank 1 achieved',
    read: true,
    readAt: new Date('2026-09-13T07:00:00.000Z'),
    createdAt: new Date('2026-09-13T06:55:00.000Z'),
  });

  const notif1_U2_Unread = new Notification({
    id: 'notif-u2-1',
    userId: 'user-bob',
    type: 'system_announcement',
    title: 'Reset Notice',
    body: 'Weekly reset approaching',
    read: false,
    readAt: null,
    createdAt: new Date('2026-09-13T08:10:00.000Z'),
  });

  beforeEach(() => {
    memoryRepo = new InMemoryNotificationRepository([
      new Notification({ ...notif1_U1_Unread.props }),
      new Notification({ ...notif2_U1_Unread.props }),
      new Notification({ ...notif3_U1_AlreadyRead.props }),
      new Notification({ ...notif1_U2_Unread.props }),
    ]);

    markSingleUseCase = new MarkNotificationReadUseCase(memoryRepo);
    markAllUseCase = new MarkAllNotificationsReadUseCase(memoryRepo);
  });

  describe('1. Single Notification markAsRead with Strict User Isolation', () => {
    it('should mark single notification as read and record read_at timestamp', async () => {
      const result = await markSingleUseCase.execute('user-alice', 'notif-u1-1');

      assert.equal(result.id, 'notif-u1-1');
      assert.equal(result.read, true);
      assert.ok(result.readAt);

      // Verify in repository: preserved and not deleted
      const found = await memoryRepo.findById('notif-u1-1');
      assert.ok(found);
      assert.equal(found.read, true);
      assert.ok(found.readAt);

      // Verify other notifications for user-alice remain unread
      const notif2 = await memoryRepo.findById('notif-u1-2');
      assert.equal(notif2?.read, false);
    });

    it('should reject marking another user notification as read with NotFoundError (user isolation)', async () => {
      await assert.rejects(
        async () => {
          // user-alice attempts to mark user-bob's notification
          await markSingleUseCase.execute('user-alice', 'notif-u2-1');
        },
        (err: any) => {
          assert.ok(err instanceof NotFoundError);
          return true;
        }
      );

      // Verify user-bob's notification was NOT modified
      const bobNotif = await memoryRepo.findById('notif-u2-1');
      assert.equal(bobNotif?.read, false);
      assert.equal(bobNotif?.readAt, null);
    });

    it('should reject empty or whitespace notification ID with ValidationError', async () => {
      await assert.rejects(
        async () => {
          await markSingleUseCase.execute('user-alice', '   ');
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError);
          return true;
        }
      );
    });
  });

  describe('2. Bulk markAllAsRead with User Isolation', () => {
    it('should mark all unread notifications as read for target user and leave other users unaffected', async () => {
      const res = await markAllUseCase.execute('user-alice');

      assert.equal(res.success, true);
      assert.equal(res.updatedCount, 2, 'Should have updated the 2 unread notifications for alice');

      // Verify alice's unread notifications are now read
      const notif1 = await memoryRepo.findById('notif-u1-1');
      const notif2 = await memoryRepo.findById('notif-u1-2');
      assert.equal(notif1?.read, true);
      assert.ok(notif1?.readAt);
      assert.equal(notif2?.read, true);
      assert.ok(notif2?.readAt);

      // Verify previously read notification still has its original read timestamp preserved
      const notif3 = await memoryRepo.findById('notif-u1-3');
      assert.equal(notif3?.read, true);

      // Verify unread count for alice is now 0
      const unreadAlice = await memoryRepo.getUnreadCount('user-alice');
      assert.equal(unreadAlice, 0);

      // Verify bob's unread notification was untouched
      const bobNotif = await memoryRepo.findById('notif-u2-1');
      assert.equal(bobNotif?.read, false);
      assert.equal(bobNotif?.readAt, null);
      const unreadBob = await memoryRepo.getUnreadCount('user-bob');
      assert.equal(unreadBob, 1);
    });

    it('should return updatedCount=0 when user has no unread notifications', async () => {
      const res = await markAllUseCase.execute('user-charlie');
      assert.equal(res.success, true);
      assert.equal(res.updatedCount, 0);
    });

    it('should reject empty userId with ValidationError', async () => {
      await assert.rejects(
        async () => {
          await markAllUseCase.execute('');
        },
        (err: any) => {
          assert.ok(err instanceof ValidationError);
          return true;
        }
      );
    });
  });

  describe('3. PostgresNotificationRepository Query Verification', () => {
    it('should construct markAsRead UPDATE query with strict user_id filtering', async () => {
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
                id: params[0],
                user_id: params[1],
                type: 'spawn_rotation',
                title: 'Title',
                body: 'Body',
                read: true,
                read_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
              },
            ],
          };
        },
      };

      const postgresRepo = new PostgresNotificationRepository(mockPool);
      await postgresRepo.markAsRead('notif-target-1', 'user-scoped-99');

      assert.ok(executedSql.includes('UPDATE notifications'));
      assert.ok(executedSql.includes('SET read = true'));
      assert.ok(executedSql.includes('read_at = COALESCE(read_at, NOW())'));
      assert.ok(executedSql.includes('WHERE id = $1 AND user_id = $2'));
      assert.deepEqual(executedParams, ['notif-target-1', 'user-scoped-99']);
    });

    it('should construct markAllAsRead UPDATE query with strict user_id and read=false filtering', async () => {
      let executedSql = '';
      let executedParams: any[] = [];

      const mockPool = {
        query: async (sql: string, params: any[]) => {
          executedSql = sql;
          executedParams = params;
          return {
            rowCount: 3,
            rows: [],
          };
        },
      };

      const postgresRepo = new PostgresNotificationRepository(mockPool);
      const count = await postgresRepo.markAllAsRead('user-bulk-88');

      assert.equal(count, 3);
      assert.ok(executedSql.includes('UPDATE notifications'));
      assert.ok(executedSql.includes('SET read = true'));
      assert.ok(executedSql.includes('read_at = COALESCE(read_at, NOW())'));
      assert.ok(executedSql.includes('WHERE user_id = $1 AND read = false'));
      assert.deepEqual(executedParams, ['user-bulk-88']);
    });
  });
});
