import { Router } from 'express';
import { AdminController } from '../../controllers/AdminController';
import { validateRequest } from '../../validation/validateRequest';
import { AdminToggleSpawnSchema } from '../../validation/schemas';

export function createAdminRouter(adminController: AdminController): Router {
  const router = Router();

  // GET /api/v1/admin/overview
  router.get('/overview', adminController.getOverview);

  // POST /api/v1/admin/rotate
  router.post('/rotate', adminController.triggerRotation);

  // PATCH /api/v1/admin/spawns/:id/toggle
  router.patch('/spawns/:id/toggle', validateRequest(AdminToggleSpawnSchema, 'body'), adminController.toggleSpawn);

  return router;
}
