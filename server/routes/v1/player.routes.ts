import { Router } from 'express';
import { PlayerController } from '../../controllers/PlayerController';
import { requireAuthenticatedUser } from '../../middlewares/auth';

export function createPlayerRouter(playerController: PlayerController): Router {
  const router = Router();

  // Protected representative routes: GET /api/v1/player/me...
  router.get('/me', requireAuthenticatedUser, playerController.getMyProfile);
  router.get('/me/stats', requireAuthenticatedUser, playerController.getMyStats);
  router.get('/me/claims', requireAuthenticatedUser, playerController.getMyClaims);

  // Protected route: PATCH /api/v1/player/me/preferences
  router.patch('/me/preferences', requireAuthenticatedUser, playerController.updatePreferences);

  // Public/player route: GET /api/v1/player/:id
  router.get('/:id', playerController.getProfile);

  return router;
}
