import { Router } from 'express';
import { AdminController } from '../../controllers/AdminController';
import { validateRequest } from '../../validation/validateRequest';
import {
  AdminToggleSpawnSchema,
  AdminCreateSpawnSchema,
  AdminEditSpawnSchema,
} from '../../validation/schemas';
import { requireAdmin } from '../../middlewares/auth';
import { IAuditService } from '../../services/IAuditService';
import { auditAdminMutations } from '../../middlewares/auditMiddleware';

export function createAdminRouter(adminController: AdminController, auditService?: IAuditService): Router {
  const router = Router();

  // Audit logging for privileged operations (records successful mutations, unauthorized probes, and failures)
  if (auditService) {
    router.use(auditAdminMutations(auditService));
  }

  // All administrative routes strictly require server-controlled ADMIN role
  router.use(requireAdmin);

  // 1. Administrative Overview & Dashboard
  router.get('/overview', adminController.getOverview);

  // 2. Spawn Point Management (Creation, Editing, Enabling/Disabling)
  router.post('/spawns', validateRequest(AdminCreateSpawnSchema, 'body'), adminController.createSpawn);
  router.put('/spawns/:id', validateRequest(AdminEditSpawnSchema, 'body'), adminController.editSpawn);
  router.patch('/spawns/:id', validateRequest(AdminEditSpawnSchema, 'body'), adminController.editSpawn);
  router.patch('/spawns/:id/toggle', validateRequest(AdminToggleSpawnSchema, 'body'), adminController.toggleSpawn);

  // 3. Rotation Configuration & Force Rotation
  router.get('/rotation/config', adminController.getRotationConfig);
  router.put('/rotation/config', adminController.updateRotationConfig);
  router.post('/rotate', adminController.triggerRotation);
  router.post('/rotation/force', adminController.triggerRotation);

  // 4. Weekly-Reset Configuration & Manual Reset
  router.get('/cycles/config', adminController.getWeeklyResetConfig);
  router.put('/cycles/config', adminController.updateWeeklyResetConfig);
  router.post('/cycles/reset', adminController.manualWeeklyReset);

  // 5. Game Settings Management
  router.get('/settings', adminController.getGameSettings);
  router.put('/settings', adminController.updateGameSettings);

  return router;
}
