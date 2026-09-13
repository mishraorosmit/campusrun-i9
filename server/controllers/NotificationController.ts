import { Request, Response, NextFunction } from 'express';
import { GetPlayerNotificationsUseCase } from '../services/GetPlayerNotificationsUseCase';
import { MarkNotificationAsReadUseCase } from '../services/MarkNotificationAsReadUseCase';
import { GetUnreadNotificationCountUseCase } from '../services/GetUnreadNotificationCountUseCase';
import { MarkAllNotificationsReadUseCase } from '../services/MarkAllNotificationsReadUseCase';
import { UnauthorizedError, ValidationError } from '../errors';

export class NotificationController {
  constructor(
    private readonly getPlayerNotificationsUseCase: GetPlayerNotificationsUseCase,
    private readonly markNotificationAsReadUseCase: MarkNotificationAsReadUseCase,
    private readonly getUnreadNotificationCountUseCase?: GetUnreadNotificationCountUseCase,
    private readonly markAllNotificationsReadUseCase?: MarkAllNotificationsReadUseCase
  ) {}

  /**
   * Retrieves the authenticated user's notifications ordered by newest first with pagination.
   * GET /api/v1/me/notifications or GET /api/v1/notifications
   */
  public getMyNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const rawLimit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : 50;
      const rawOffset = req.query.offset !== undefined ? parseInt(req.query.offset as string, 10) : 0;

      const limit = isNaN(rawLimit) || rawLimit < 0 ? 50 : Math.min(rawLimit, 100);
      const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

      const notifications = await this.getPlayerNotificationsUseCase.execute(userId, limit, offset);

      res.status(200).json({
        success: true,
        data: notifications,
        limit,
        offset,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Retrieves unread notification count for the authenticated user.
   * GET /api/v1/me/notifications/unread-count or GET /api/v1/notifications/unread-count
   */
  public getUnreadCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      if (!this.getUnreadNotificationCountUseCase) {
        throw new Error('GetUnreadNotificationCountUseCase is not configured');
      }

      const unreadCount = await this.getUnreadNotificationCountUseCase.execute(userId);

      res.status(200).json({
        unreadCount,
        success: true,
        data: {
          unreadCount,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Marks notification(s) as read for the authenticated user.
   * POST /api/v1/notifications/read or PATCH /api/v1/notifications/read
   * Handles:
   * 1. { markAllRead: true } -> mark all notifications as read
   * 2. { notificationIds: ["id1", "id2"] } -> mark multiple by IDs
   * 3. { notificationId: "id" } or { id: "id" } -> mark single notification
   */
  public markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const body = req.body || {};
      const { markAllRead, markAll, all, notificationIds, notificationId, id } = body;

      // 1. Bulk mark all read
      if (markAllRead === true || markAll === true || all === true) {
        if (!this.markAllNotificationsReadUseCase) {
          throw new Error('MarkAllNotificationsReadUseCase is not configured');
        }
        const result = await this.markAllNotificationsReadUseCase.execute(userId);
        res.status(200).json({
          success: true,
          data: result,
          updatedCount: result.updatedCount,
        });
        return;
      }

      // 2. Batch array of notificationIds
      if (notificationIds !== undefined) {
        if (!Array.isArray(notificationIds)) {
          throw new ValidationError('notificationIds must be an array of notification IDs');
        }
        if (notificationIds.length === 0) {
          throw new ValidationError('notificationIds array cannot be empty');
        }

        const results = [];
        for (const notifId of notificationIds) {
          if (typeof notifId !== 'string' || !notifId.trim()) {
            throw new ValidationError('Each notificationId must be a non-empty string');
          }
          const updated = await this.markNotificationAsReadUseCase.execute(userId, notifId.trim());
          results.push(updated);
        }

        res.status(200).json({
          success: true,
          data: results,
          updatedCount: results.length,
        });
        return;
      }

      // 3. Single notification ID
      const targetId = notificationId || id;
      if (targetId && typeof targetId === 'string' && targetId.trim()) {
        const updated = await this.markNotificationAsReadUseCase.execute(userId, targetId.trim());
        res.status(200).json({
          success: true,
          data: updated,
        });
        return;
      }

      // 4. If invalid/empty input
      throw new ValidationError('Notification identifier (notificationId, notificationIds, or markAllRead: true) is required');
    } catch (err) {
      next(err);
    }
  };
}
