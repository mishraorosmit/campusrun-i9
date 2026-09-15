import { Router } from 'express';
import { PushSubscriptionController } from '../../controllers/PushSubscriptionController';
import { requireAuthenticatedUser } from '../../middlewares/auth';

export function createPushRouter(pushSubscriptionController: PushSubscriptionController): Router {
  const router = Router();

  // All push subscription endpoints strictly require authentication
  router.use(requireAuthenticatedUser);

  // POST /api/v1/push/subscribe
  router.post('/subscribe', pushSubscriptionController.subscribe);

  // DELETE /api/v1/push/subscribe
  router.delete('/subscribe', pushSubscriptionController.unsubscribe);

  return router;
}
