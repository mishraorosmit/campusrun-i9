import { Router } from 'express';
import { GameController } from '../../controllers/GameController';

export function createGameRouter(gameController: GameController): Router {
  const router = Router();

  // GET /api/v1/game/state
  router.get('/state', gameController.getGameState);

  // GET /api/v1/game/rotation
  router.get('/rotation', gameController.getGameRotation);

  return router;
}
