import { Router } from 'express';
import { PlayerController } from '../../controllers/PlayerController';

export function createPlayerRouter(playerController: PlayerController): Router {
  const router = Router();

  // GET /api/v1/player/me or /api/v1/player/:id
  router.get('/me', playerController.getProfile);
  router.get('/:id', playerController.getProfile);

  return router;
}
