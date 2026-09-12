import { Router } from 'express';
import { ZoneController } from '../../controllers/ZoneController';

export function createZonesRouter(zoneController: ZoneController): Router {
  const router = Router();

  // GET /api/v1/zones
  router.get('/', zoneController.getAllZones);

  // GET /api/v1/zones/:id
  router.get('/:id', zoneController.getZoneById);

  return router;
}
