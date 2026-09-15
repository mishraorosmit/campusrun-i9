import { Router } from 'express';
import { SpawnController } from '../../controllers/SpawnController';
import { ClaimController } from '../../controllers/ClaimController';
import { PlayerController } from '../../controllers/PlayerController';
import { LeaderboardController } from '../../controllers/LeaderboardController';
import { ZoneController } from '../../controllers/ZoneController';
import { AdminController } from '../../controllers/AdminController';
import { AuthController } from '../../controllers/AuthController';
import { WeeklyCycleController } from '../../controllers/WeeklyCycleController';
import { NotificationController } from '../../controllers/NotificationController';
import { PushSubscriptionController } from '../../controllers/PushSubscriptionController';
import { GameController } from '../../controllers/GameController';
import { IAuditService } from '../../services/IAuditService';

import { createSpawnsRouter } from './spawns.routes';
import { createClaimsRouter } from './claims.routes';
import { createPlayerRouter } from './player.routes';
import { createLeaderboardRouter } from './leaderboard.routes';
import { createZonesRouter } from './zones.routes';
import { createAdminRouter } from './admin.routes';
import { createAuthRouter } from './auth.routes';
import { createWeeklyCycleRouter } from './weeklyCycle.routes';
import { createNotificationsRouter } from './notifications.routes';
import { createPushRouter } from './push.routes';
import { createGameRouter } from './game.routes';

import { requireAuthenticatedUser } from '../../middlewares/auth';

export interface V1Controllers {
  spawnController: SpawnController;
  claimController: ClaimController;
  playerController: PlayerController;
  leaderboardController: LeaderboardController;
  zoneController: ZoneController;
  adminController: AdminController;
  authController: AuthController;
  weeklyCycleController: WeeklyCycleController;
  notificationController: NotificationController;
  pushSubscriptionController?: PushSubscriptionController;
  gameController?: GameController;
  auditService?: IAuditService;
}

export function createV1Router(controllers: V1Controllers): Router {
  const router = Router();

  // Root /me aliases for authenticated player profile, stats, claims, preferences & notifications
  router.get('/me', requireAuthenticatedUser, controllers.playerController.getMyProfile);
  router.get('/me/stats', requireAuthenticatedUser, controllers.playerController.getMyStats);
  router.get('/me/claims', requireAuthenticatedUser, controllers.playerController.getMyClaims);
  router.get('/me/notifications/unread-count', requireAuthenticatedUser, controllers.notificationController.getUnreadCount);
  router.get('/me/notifications', requireAuthenticatedUser, controllers.notificationController.getMyNotifications);
  router.post('/me/notifications/read', requireAuthenticatedUser, controllers.notificationController.markAsRead);
  router.patch('/me/notifications/read', requireAuthenticatedUser, controllers.notificationController.markAsRead);
  router.patch('/me/preferences', requireAuthenticatedUser, controllers.playerController.updatePreferences);

  router.use('/auth', createAuthRouter(controllers.authController));
  router.use('/spawns', createSpawnsRouter(controllers.spawnController));
  router.use('/claims', createClaimsRouter(controllers.claimController));
  router.use('/player', createPlayerRouter(controllers.playerController));
  router.use('/players', createPlayerRouter(controllers.playerController));
  router.use('/leaderboard', createLeaderboardRouter(controllers.leaderboardController));
  router.use('/zones', createZonesRouter(controllers.zoneController));
  router.use('/admin', createAdminRouter(controllers.adminController, controllers.auditService));
  router.use('/weekly-cycle', createWeeklyCycleRouter(controllers.weeklyCycleController));
  router.use('/notifications', createNotificationsRouter(controllers.notificationController));
  if (controllers.pushSubscriptionController) {
    router.use('/push', createPushRouter(controllers.pushSubscriptionController));
  }
  if (controllers.gameController) {
    router.use('/game', createGameRouter(controllers.gameController));
  }

  return router;
}
