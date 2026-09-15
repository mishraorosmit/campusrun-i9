import { Router } from 'express';
import { NotificationController } from '../../controllers/NotificationController';
import { requireAuthenticatedUser } from '../../middlewares/auth';

export function createNotificationsRouter(notificationController: NotificationController): Router {
  const router = Router();

  // All notification endpoints strictly require authentication
  router.use(requireAuthenticatedUser);

  // GET /api/v1/notifications/unread-count
  router.get('/unread-count', notificationController.getUnreadCount);

  // GET /api/v1/notifications
  router.get('/', notificationController.getMyNotifications);

  // POST /api/v1/notifications/read & PATCH /api/v1/notifications/read
  router.post('/read', notificationController.markAsRead);
  router.patch('/read', notificationController.markAsRead);

  return router;
}
