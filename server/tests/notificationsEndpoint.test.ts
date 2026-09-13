import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationController } from '../controllers/NotificationController';
import { GetPlayerNotificationsUseCase } from '../services/GetPlayerNotificationsUseCase';
import { MarkNotificationAsReadUseCase } from '../services/MarkNotificationAsReadUseCase';
import { GetUnreadNotificationCountUseCase } from '../services/GetUnreadNotificationCountUseCase';
import { MarkAllNotificationsReadUseCase } from '../services/MarkAllNotificationsReadUseCase';
import { InMemoryNotificationRepository } from '../infrastructure/repositories/inmemory/InMemoryNotificationRepository';
import { Notification } from '../domain/entities/Notification';
import { requireCurrentUser } from '../middlewares/auth';

describe('Notifications Endpoints (GET /api/v1/me/notifications, GET /api/v1/me/notifications/unread-count & POST /api/v1/notifications/read)', () => {
  let notificationRepo: InMemoryNotificationRepository;
  let getPlayerNotificationsUseCase: GetPlayerNotificationsUseCase;
  let markNotificationAsReadUseCase: MarkNotificationAsReadUseCase;
  let getUnreadNotificationCountUseCase: GetUnreadNotificationCountUseCase;
  let markAllNotificationsReadUseCase: MarkAllNotificationsReadUseCase;
  let notificationController: NotificationController;

  const notif1User1 = new Notification({
    id: 'notif-u1-01',
    userId: 'user-notif-1',
    type: 'spawn_rotation',
    title: 'New Spawns Available',
    body: '15 new point drops have spawned across campus!',
    read: false,
    readAt: null,
    entityType: 'spawn_batch',
    entityId: 'batch-01',
    createdAt: new Date('2026-09-12T10:00:00.000Z'),
  });

  const notif2User1 = new Notification({
    id: 'notif-u1-02',
    userId: 'user-notif-1',
    type: 'streak_reminder',
    title: 'Streak Expiring Soon',
    body: 'Claim a point drop today to maintain your 4-day streak!',
    read: false,
    readAt: null,
    entityType: null,
    entityId: null,
    createdAt: new Date('2026-09-13T08:00:00.000Z'), // Newest for user 1
  });

  const notif3User1Read = new Notification({
    id: 'notif-u1-03',
    userId: 'user-notif-1',
    type: 'claim_reward',
    title: 'Claim Confirmed',
    body: 'You earned 100 points at Gymnasium Quad.',
    read: true,
    readAt: new Date('2026-09-10T12:05:00.000Z'),
    entityType: 'claim',
    entityId: 'clm-002',
    createdAt: new Date('2026-09-10T12:00:00.000Z'), // Oldest for user 1
  });

  const notif1User2 = new Notification({
    id: 'notif-u2-01',
    userId: 'user-notif-2',
    type: 'system_announcement',
    title: 'Weekly Cycle Reset',
    body: 'Weekly competition reset completed.',
    read: false,
    readAt: null,
    entityType: 'weekly_cycle',
    entityId: 'cycle-01',
    createdAt: new Date('2026-09-13T09:00:00.000Z'),
  });

  beforeEach(() => {
    notificationRepo = new InMemoryNotificationRepository([
      new Notification({ ...notif1User1.props }),
      new Notification({ ...notif2User1.props }),
      new Notification({ ...notif3User1Read.props }),
      new Notification({ ...notif1User2.props }),
    ]);

    getPlayerNotificationsUseCase = new GetPlayerNotificationsUseCase(notificationRepo);
    markNotificationAsReadUseCase = new MarkNotificationAsReadUseCase(notificationRepo);
    getUnreadNotificationCountUseCase = new GetUnreadNotificationCountUseCase(notificationRepo);
    markAllNotificationsReadUseCase = new MarkAllNotificationsReadUseCase(notificationRepo);

    notificationController = new NotificationController(
      getPlayerNotificationsUseCase,
      markNotificationAsReadUseCase,
      getUnreadNotificationCountUseCase,
      markAllNotificationsReadUseCase
    );
  });

  describe('1. GET /api/v1/me/notifications', () => {
    it('should reject unauthenticated requests with 401 Unauthorized', () => {
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
      const req: any = { query: {} };
      const res: any = { json() {} };
      let errReceived: any = null;

      await notificationController.getMyNotifications(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should return only the authenticated user notifications ordered by newest first', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        query: {},
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

      await notificationController.getMyNotifications(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.ok(Array.isArray(responseBody.data));
      assert.equal(responseBody.data.length, 3);

      // Verify ordering: newest first
      assert.equal(responseBody.data[0].id, 'notif-u1-02'); // 2026-09-13T08:00:00Z
      assert.equal(responseBody.data[0].read, false);

      assert.equal(responseBody.data[1].id, 'notif-u1-01'); // 2026-09-12T10:00:00Z
      assert.equal(responseBody.data[1].read, false);

      assert.equal(responseBody.data[2].id, 'notif-u1-03'); // 2026-09-10T12:00:00Z
      assert.equal(responseBody.data[2].read, true);
      assert.ok(responseBody.data[2].readAt);

      // Verify user 2's notification is NOT returned
      const hasUser2Notif = responseBody.data.some((n: any) => n.id === 'notif-u2-01');
      assert.equal(hasUser2Notif, false);
    });

    it('should correctly support limit and offset pagination parameters', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        query: { limit: '1', offset: '1' },
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

      await notificationController.getMyNotifications(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.data.length, 1);
      assert.equal(responseBody.data[0].id, 'notif-u1-01');
      assert.equal(responseBody.limit, 1);
      assert.equal(responseBody.offset, 1);
    });
  });

  describe('2. GET /api/v1/me/notifications/unread-count', () => {
    it('should reject unauthenticated request with 401 Unauthorized', async () => {
      const req: any = {};
      const res: any = {};
      let errReceived: any = null;

      await notificationController.getUnreadCount(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should return { "unreadCount": number } for authenticated user', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
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

      await notificationController.getUnreadCount(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.unreadCount, 2); // notif-u1-01 and notif-u1-02 are unread
      assert.equal(responseBody.success, true);
    });

    it('should isolate unread count per user', async () => {
      const req: any = {
        user: { id: 'user-notif-2', email: 'u2@campus.edu', username: 'user_two', role: 'STUDENT' },
      };

      let responseBody: any = null;
      const res: any = {
        status() {
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await notificationController.getUnreadCount(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseBody.unreadCount, 1); // notif-u2-01
    });
  });

  describe('3. POST /api/v1/notifications/read', () => {
    it('should reject unauthenticated request with 401 Unauthorized', () => {
      const req: any = { headers: {} };
      const res: any = {};
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should reject empty or missing notification identifier with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: {},
      };
      const res: any = {};
      let errReceived: any = null;

      await notificationController.markAsRead(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
      assert.match(errReceived.message, /Notification identifier/i);
    });

    it('should return 404 if single notification does not exist', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: { notificationId: 'non-existent-id' },
      };
      const res: any = {};
      let errReceived: any = null;

      await notificationController.markAsRead(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 404);
    });

    it('should return 404 if single notification belongs to another user', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: { notificationId: 'notif-u2-01' }, // belongs to user 2
      };
      const res: any = {};
      let errReceived: any = null;

      await notificationController.markAsRead(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 404);

      // Verify user 2's notification remains unread
      const notifUser2 = await notificationRepo.findById('notif-u2-01');
      assert.equal(notifUser2?.read, false);
    });

    it('should successfully mark a single notification as read by notificationId', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: { notificationId: 'notif-u1-02' },
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

      await notificationController.markAsRead(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.ok(responseBody.data);
      assert.equal(responseBody.data.id, 'notif-u1-02');
      assert.equal(responseBody.data.read, true);
      assert.ok(responseBody.data.readAt);

      const updatedNotif = await notificationRepo.findById('notif-u1-02');
      assert.equal(updatedNotif?.read, true);

      // notif-u1-01 remains unread
      const untouchedNotif = await notificationRepo.findById('notif-u1-01');
      assert.equal(untouchedNotif?.read, false);
    });

    it('should successfully mark batch notification IDs as read via notificationIds: string[]', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: { notificationIds: ['notif-u1-01', 'notif-u1-02'] },
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

      await notificationController.markAsRead(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.equal(responseBody.updatedCount, 2);

      const notif1 = await notificationRepo.findById('notif-u1-01');
      const notif2 = await notificationRepo.findById('notif-u1-02');
      assert.equal(notif1?.read, true);
      assert.equal(notif2?.read, true);
    });

    it('should reject invalid notificationIds payload with 400', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: { notificationIds: [] },
      };
      const res: any = {};
      let errReceived: any = null;

      await notificationController.markAsRead(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
    });

    it('should bulk mark all user notifications as read via markAllRead: true', async () => {
      const req: any = {
        user: { id: 'user-notif-1', email: 'u1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: { markAllRead: true },
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

      await notificationController.markAsRead(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.equal(responseBody.updatedCount, 2); // 2 unread became read

      const unreadCount = await notificationRepo.getUnreadCount('user-notif-1');
      assert.equal(unreadCount, 0);

      // User 2 unread notification is untouched
      const user2Unread = await notificationRepo.getUnreadCount('user-notif-2');
      assert.equal(user2Unread, 1);
    });
  });
});
