import { Router, RequestHandler } from 'express';
import { AdminController } from '../../controllers/AdminController';
import { validateRequest } from '../../validation/validateRequest';
import { AdminToggleSpawnSchema } from '../../validation/schemas';
import { requireAdmin } from '../../middlewares/auth';
import { IAuditService } from '../../services/IAuditService';
import { auditAdminMutations } from '../../middlewares/auditMiddleware';

export function createAdminRouter(
  adminController: AdminController,
  auditService?: IAuditService,
  authMiddleware?: RequestHandler
): Router {
  const router = Router();

  // Audit logging for privileged operations
  if (auditService) {
    router.use(auditAdminMutations(auditService));
  }

  // Administrative route authorization
  if (authMiddleware) {
    router.use(authMiddleware);
  } else {
    router.use(requireAdmin);
  }

  // 1. Administrative Overview & Dashboard
  router.get('/overview', adminController.getOverview);

  // 2. Spawn Point Management (Creation, Editing, Enabling/Disabling)
  router.post('/spawns', adminController.createSpawn);
  router.put('/spawns/:id', adminController.editSpawn);
  router.patch('/spawns/:id', adminController.editSpawn);
  router.patch('/spawns/:id/toggle', validateRequest(AdminToggleSpawnSchema, 'body'), adminController.toggleSpawn);

  // 3. Rotation Configuration & Force Rotation
  router.get('/rotation/config', adminController.getRotationConfig);
  router.put('/rotation/config', adminController.updateRotationConfig);
  router.post('/rotate', adminController.triggerRotation);

  // 4. Weekly-Reset Configuration & Manual Reset
  router.get('/cycles/config', adminController.getWeeklyResetConfig);
  router.put('/cycles/config', adminController.updateWeeklyResetConfig);
  router.post('/cycles/reset', adminController.manualWeeklyReset);

  // 5. Game Settings Management
  router.get('/settings', adminController.getGameSettings);
  router.put('/settings', adminController.updateGameSettings);

  // POST /api/v1/admin/leaderboard/reset-weekly
  router.post('/leaderboard/reset-weekly', adminController.resetWeeklyLeaderboard);

  // POST /api/v1/admin/weekly-cycle/reset
  router.post('/weekly-cycle/reset', adminController.resetWeeklyCycle);
  router.post('/weekly-cycle/reset-weekly', adminController.resetWeeklyCycle);

  return router;
}
