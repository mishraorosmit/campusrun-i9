import { Router } from 'express';
import { SpawnController } from '../../controllers/SpawnController';
import { ClaimController } from '../../controllers/ClaimController';
import { PlayerController } from '../../controllers/PlayerController';
import { LeaderboardController } from '../../controllers/LeaderboardController';
import { ZoneController } from '../../controllers/ZoneController';
import { AdminController } from '../../controllers/AdminController';
import { AuthController } from '../../controllers/AuthController';

import { createSpawnsRouter } from './spawns.routes';
import { createClaimsRouter } from './claims.routes';
import { createPlayerRouter } from './player.routes';
import { createLeaderboardRouter } from './leaderboard.routes';
import { createZonesRouter } from './zones.routes';
import { createAdminRouter } from './admin.routes';
import { createAuthRouter } from './auth.routes';

export interface V1Controllers {
  spawnController: SpawnController;
  claimController: ClaimController;
  playerController: PlayerController;
  leaderboardController: LeaderboardController;
  zoneController: ZoneController;
  adminController: AdminController;
  authController: AuthController;
}

export function createV1Router(controllers: V1Controllers): Router {
  const router = Router();

  router.use('/auth', createAuthRouter(controllers.authController));
  router.use('/spawns', createSpawnsRouter(controllers.spawnController));
  router.use('/claims', createClaimsRouter(controllers.claimController));
  router.use('/player', createPlayerRouter(controllers.playerController));
  router.use('/players', createPlayerRouter(controllers.playerController));
  router.use('/leaderboard', createLeaderboardRouter(controllers.leaderboardController));
  router.use('/zones', createZonesRouter(controllers.zoneController));
  router.use('/admin', createAdminRouter(controllers.adminController));

  return router;
}
