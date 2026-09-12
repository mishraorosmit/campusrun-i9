import { Router } from 'express';
import { SpawnController } from '../../controllers/SpawnController';
import { validateRequest } from '../../validation/validateRequest';
import { SpawnFilterSchema } from '../../validation/schemas';

export function createSpawnsRouter(spawnController: SpawnController): Router {
  const router = Router();

  // GET /api/v1/spawns
  router.get('/', validateRequest(SpawnFilterSchema, 'query'), spawnController.getActiveSpawns);

  // GET /api/v1/spawns/:id
  router.get('/:id', spawnController.getSpawnById);

  return router;
}
