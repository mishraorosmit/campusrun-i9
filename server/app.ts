import express, { Express } from 'express';
import { config } from './config';
import { errorHandler } from './middlewares/errorHandler';
import { requestLogger } from './middlewares/requestLogger';
import { notFoundHandler } from './middlewares/notFoundHandler';
import { createApiRouter } from './routes';

// Repositories (In-Memory Adapters for Phase 02/03 skeleton)
import {
  InMemorySpawnRepository,
  InMemoryPlayerRepository,
  InMemoryClaimRepository,
  InMemoryZoneRepository,
  InMemoryRotationRepository,
  InMemoryLeaderboardRepository,
  InMemoryWeeklyCycleRepository,
  geoCalculator,
} from './infrastructure';

// PostgreSQL transaction support
import { TransactionManager } from './infrastructure/database/transaction';
import { dbPool } from './infrastructure/database/pool';
import { PostgresClaimRepository } from './infrastructure/repositories/postgres/PostgresClaimRepository';
import { PostgresPlayerRepository } from './infrastructure/repositories/postgres/PostgresPlayerRepository';
import { PostgresLeaderboardRepository } from './infrastructure/repositories/postgres/PostgresLeaderboardRepository';
import { PostgresWeeklyCycleRepository } from './infrastructure/repositories/postgres/PostgresWeeklyCycleRepository';

// Google OIDC Client
import { GoogleOidcClient } from './infrastructure/auth/GoogleOidcClient';

// Event Bus
import { eventBus } from './events';

// Use Cases & Services
import {
  ClaimSpawnUseCase,
  GetActiveSpawnsUseCase,
  GetSpawnByIdUseCase,
  RotateSpawnsUseCase,
  GetLeaderboardUseCase,
  GetPlayerProfileUseCase,
  GetClaimsHistoryUseCase,
  GetZonesUseCase,
  GetZoneByIdUseCase,
  GetAdminOverviewUseCase,
  AdminManageSpawnsUseCase,
  ResetWeeklyLeaderboardUseCase,
  WeeklyCycleService,
  GetNextWeeklyResetUseCase,
  ResetWeeklyCycleUseCase,
  AuthService,
} from './services';

// Controllers
import {
  SpawnController,
  ClaimController,
  PlayerController,
  LeaderboardController,
  ZoneController,
  AdminController,
  AuthController,
  WeeklyCycleController,
} from './controllers';

import { ILeaderboardRepository, IWeeklyCycleRepository } from './repositories';

export interface AppDependencies {
  spawnRepo?: InMemorySpawnRepository;
  playerRepo?: InMemoryPlayerRepository;
  claimRepo?: InMemoryClaimRepository;
  zoneRepo?: InMemoryZoneRepository;
  rotationRepo?: InMemoryRotationRepository;
  leaderboardRepo?: ILeaderboardRepository;
  weeklyCycleRepo?: IWeeklyCycleRepository;
  oidcClient?: GoogleOidcClient;
}

export function createApp(deps: AppDependencies = {}): Express {
  const app = express();

  // 1. Core Middlewares
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 2. CORS Handling
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', config.CORS_ORIGIN);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // 3. Request Logging
  if (config.NODE_ENV !== 'test') {
    app.use(requestLogger);
  }

  // 4. Composition Root (Dependency Injection)
  const spawnRepo = deps.spawnRepo || new InMemorySpawnRepository();
  const playerRepo = deps.playerRepo || new InMemoryPlayerRepository();
  const claimRepo = deps.claimRepo || new InMemoryClaimRepository();
  const zoneRepo = deps.zoneRepo || new InMemoryZoneRepository();
  const rotationRepo = deps.rotationRepo || new InMemoryRotationRepository();
  const pgLeaderboardRepo = new PostgresLeaderboardRepository(dbPool.getPool());
  const leaderboardRepo = deps.leaderboardRepo || pgLeaderboardRepo;
  const pgWeeklyCycleRepo = new PostgresWeeklyCycleRepository(dbPool.getPool());
  const weeklyCycleRepo = deps.weeklyCycleRepo || pgWeeklyCycleRepo;
  const oidcClient =
    deps.oidcClient ||
    new GoogleOidcClient(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_CALLBACK_URL);

  // Authentication Service
  const authService = new AuthService(oidcClient, playerRepo, {
    collegeDomain: config.AUTH_COLLEGE_DOMAIN,
    jwtSecret: config.JWT_SECRET,
    jwtAccessExpirationSeconds: config.JWT_ACCESS_EXPIRATION_SECONDS,
    refreshTokenExpirationSeconds: config.REFRESH_TOKEN_EXPIRATION_SECONDS,
  });

  const txManager = new TransactionManager();
  const pgClaimRepo = new PostgresClaimRepository(dbPool.getPool());
  const pgPlayerRepo = new PostgresPlayerRepository(dbPool.getPool());

  // Use Cases (Orchestration layer)
  const claimSpawnUseCase = new ClaimSpawnUseCase(
    spawnRepo,
    pgPlayerRepo,
    pgClaimRepo,
    leaderboardRepo,
    geoCalculator,
    eventBus,
    txManager
  );
  const getActiveSpawnsUseCase = new GetActiveSpawnsUseCase(spawnRepo);
  const getSpawnByIdUseCase = new GetSpawnByIdUseCase(spawnRepo);
  const rotateSpawnsUseCase = new RotateSpawnsUseCase(
    rotationRepo,
    spawnRepo,
    eventBus,
    {
      rotationIntervalMinutes: config.ROTATION_INTERVAL_MINUTES,
      concurrentActiveSpawns: config.CONCURRENT_ACTIVE_SPAWNS,
    }
  );
  const getLeaderboardUseCase = new GetLeaderboardUseCase(leaderboardRepo);
  const getPlayerProfileUseCase = new GetPlayerProfileUseCase(playerRepo);
  const getClaimsHistoryUseCase = new GetClaimsHistoryUseCase(claimRepo);
  const getZonesUseCase = new GetZonesUseCase(zoneRepo);
  const getZoneByIdUseCase = new GetZoneByIdUseCase(zoneRepo);
  const getAdminOverviewUseCase = new GetAdminOverviewUseCase(spawnRepo, claimRepo);
  const adminManageSpawnsUseCase = new AdminManageSpawnsUseCase(spawnRepo);
  const resetWeeklyLeaderboardUseCase = new ResetWeeklyLeaderboardUseCase(leaderboardRepo);
  const weeklyCycleService = new WeeklyCycleService(weeklyCycleRepo, leaderboardRepo, txManager);
  const getNextWeeklyResetUseCase = new GetNextWeeklyResetUseCase(weeklyCycleService);
  const resetWeeklyCycleUseCase = new ResetWeeklyCycleUseCase(weeklyCycleService);

  // Controllers (Driving HTTP Adapters - ZERO repository dependencies)
  const spawnController = new SpawnController(getActiveSpawnsUseCase, getSpawnByIdUseCase);
  const claimController = new ClaimController(claimSpawnUseCase, getClaimsHistoryUseCase);
  const playerController = new PlayerController(getPlayerProfileUseCase);
  const leaderboardController = new LeaderboardController(getLeaderboardUseCase);
  const zoneController = new ZoneController(getZonesUseCase, getZoneByIdUseCase);
  const adminController = new AdminController(
    adminManageSpawnsUseCase,
    rotateSpawnsUseCase,
    getAdminOverviewUseCase,
    resetWeeklyLeaderboardUseCase,
    resetWeeklyCycleUseCase,
    weeklyCycleRepo
  );
  const authController = new AuthController(authService);
  const weeklyCycleController = new WeeklyCycleController(getNextWeeklyResetUseCase);

  // 5. Mount API Routes under /api
  const apiRouter = createApiRouter({
    spawnController,
    claimController,
    playerController,
    leaderboardController,
    zoneController,
    adminController,
    authController,
    weeklyCycleController,
  });

  app.use('/api', apiRouter);

  // 6. Catch-all Not Found Handler (forwards to errorHandler)
  app.use(notFoundHandler);

  // 7. Global Centralized Error Handler (RFC 7807 problem details)
  app.use(errorHandler);

  return app;
}
