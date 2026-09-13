import { Request, Response, NextFunction } from 'express';
import { SavePushSubscriptionUseCase } from '../services/SavePushSubscriptionUseCase';
import { DeletePushSubscriptionUseCase } from '../services/DeletePushSubscriptionUseCase';
import { UnauthorizedError } from '../errors';

export class PushSubscriptionController {
  constructor(
    private readonly savePushSubscriptionUseCase: SavePushSubscriptionUseCase,
    private readonly deletePushSubscriptionUseCase: DeletePushSubscriptionUseCase
  ) {}

  /**
   * Stores or updates a browser push subscription for the authenticated user.
   * POST /api/v1/push/subscribe
   */
  public subscribe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const userAgent = req.headers['user-agent'] || undefined;
      const input = {
        ...req.body,
        userAgent: req.body?.userAgent || userAgent,
      };

      const result = await this.savePushSubscriptionUseCase.execute(userId, input);

      res.status(200).json({
        success: true,
        message: 'Push subscription saved successfully',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Removes a browser push subscription belonging to the authenticated user.
   * DELETE /api/v1/push/subscribe
   */
  public unsubscribe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const endpoint = req.body?.endpoint || (req.query?.endpoint as string | undefined);
      const id = req.body?.id || req.body?.subscriptionId || (req.query?.id as string | undefined);

      const input = {
        endpoint,
        id,
      };

      const result = await this.deletePushSubscriptionUseCase.execute(userId, input);

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  };
}
