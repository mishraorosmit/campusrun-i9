import { Router } from 'express';
import { SpawnController } from '../../controllers/SpawnController';
import { validateRequest } from '../../validation/validateRequest';
import { SpawnFilterSchema } from '../../validation/schemas';

export function createSpawnsRouter(spawnController: SpawnController): Router {
  const router = Router();

  // GET /api/v1/spawns/active
  router.get('/active', validateRequest(SpawnFilterSchema, 'query'), spawnController.getActiveSpawns);

  // GET /api/v1/spawns
  router.get('/', (req, res, next) => {
    // If bounding box query parameters are present, delegate to getActiveSpawns
    if (req.query.north || req.query.south || req.query.east || req.query.west) {
      return spawnController.getActiveSpawns(req, res, next);
    }
    return spawnController.listSpawns(req, res, next);
  });

  // GET /api/v1/spawns/:id
  router.get('/:id', spawnController.getSpawnById);

  return router;
}
