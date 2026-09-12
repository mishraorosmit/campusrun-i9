import { Router, RequestHandler } from 'express';
import { AdminController } from '../../controllers/AdminController';
import { validateRequest } from '../../validation/validateRequest';
import { AdminToggleSpawnSchema } from '../../validation/schemas';

export function createAdminRouter(adminController: AdminController, authMiddleware?: RequestHandler): Router {
  const router = Router();

  if (authMiddleware) {
    router.use(authMiddleware);
  }

  // GET /api/v1/admin/overview
  router.get('/overview', adminController.getOverview);

  // POST /api/v1/admin/rotate
  router.post('/rotate', adminController.triggerRotation);

  // PATCH /api/v1/admin/spawns/:id/toggle
  router.patch('/spawns/:id/toggle', validateRequest(AdminToggleSpawnSchema, 'body'), adminController.toggleSpawn);

  // POST /api/v1/admin/leaderboard/reset-weekly
  router.post('/leaderboard/reset-weekly', adminController.resetWeeklyLeaderboard);

  // POST /api/v1/admin/weekly-cycle/reset
  router.post('/weekly-cycle/reset', adminController.resetWeeklyCycle);
  router.post('/weekly-cycle/reset-weekly', adminController.resetWeeklyCycle);

  return router;
}
