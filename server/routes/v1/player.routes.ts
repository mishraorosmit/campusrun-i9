import { Router } from 'express';
import { PlayerController } from '../../controllers/PlayerController';
import { requireAuthenticatedUser } from '../../middlewares/auth';

export function createPlayerRouter(playerController: PlayerController): Router {
  const router = Router();

  // Protected representative route: GET /api/v1/player/me (student or admin authenticated)
  router.get('/me', requireAuthenticatedUser, playerController.getMyProfile);

  // Public/player route: GET /api/v1/player/:id
  router.get('/:id', playerController.getProfile);

  return router;
}
