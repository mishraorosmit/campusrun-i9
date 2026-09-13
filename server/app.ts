import express, { Express } from 'express';
import { config } from './config';
import { errorHandler } from './middlewares/errorHandler';
import { requestLogger } from './middlewares/requestLogger';
import { notFoundHandler } from './middlewares/notFoundHandler';
import { cookieParserMiddleware } from './middlewares/cookieParser';
import { createApiRouter } from './routes';

// Repositories (In-Memory Adapters for Phase 02/03 skeleton)
import {
  InMemorySpawnRepository,
  InMemoryBatchRepository,
  InMemoryPlayerRepository,
  InMemoryClaimRepository,
  InMemoryZoneRepository,
  InMemoryRotationRepository,
  InMemoryLeaderboardRepository,
  PostgresPlayerRepository,
  PostgresSpawnRepository,
  PostgresBatchRepository,
  PostgresClaimRepository,
  PostgresZoneRepository,
  PostgresLeaderboardRepository,
  PostgresAuditService,
  InMemoryAuditService,
  PostgresGeospatialService,
  dbPool,
  geoCalculator,
} from './infrastructure';

// Google OIDC Client
import { GoogleOidcClient } from './infrastructure/auth/GoogleOidcClient';

// Transaction Manager
import { transactionManager } from './infrastructure/database/transaction';

// Event Bus
import { eventBus } from './events';
import { IEventBus } from './events/IEventBus';

// Use Cases & Services
import {
  ClaimSpawnUseCase,
  ValidateClaimUseCase,
  GetActiveSpawnsUseCase,
  GetSpawnByIdUseCase,
  ListSpawnsUseCase,
  AdminCreateSpawnUseCase,
  AdminEditSpawnUseCase,
  AdminManageSpawnsUseCase,
  RotateSpawnsUseCase,
  GetLeaderboardUseCase,
  GetPlayerProfileUseCase,
  GetClaimsHistoryUseCase,
  GetZonesUseCase,
  GetZoneByIdUseCase,
  GetAdminOverviewUseCase,
  AuthService,
  IAuditService,
  IGeospatialService,
  GameSettingsService,
  GenerateBatchUseCase,
  ActivateBatchUseCase,
  ExpireBatchUseCase,
  GetBatchByIdUseCase,
  IRotationService,
  RotationService,
  IRotationScheduler,
  RotationScheduler,
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
} from './controllers';

import {
  IPlayerRepository,
  ISpawnRepository,
  IBatchRepository,
  IClaimRepository,
  IZoneRepository,
  ILeaderboardRepository,
} from './repositories';

export interface AppDependencies {
  spawnRepo?: ISpawnRepository;
  batchRepo?: IBatchRepository;
  playerRepo?: IPlayerRepository;
  claimRepo?: IClaimRepository;
  zoneRepo?: IZoneRepository;
  rotationRepo?: InMemoryRotationRepository;
  leaderboardRepo?: ILeaderboardRepository;
  oidcClient?: GoogleOidcClient;
  auditService?: IAuditService;
  geoService?: IGeospatialService;
  rotationService?: IRotationService;
  rotationScheduler?: IRotationScheduler;
  claimSpawnUseCase?: ClaimSpawnUseCase;
  eventBus?: IEventBus;
  validateOnlyClaims?: boolean;
}

export function createApp(deps: AppDependencies = {}): Express {
  const app = express();

  // 1. Core Middlewares
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParserMiddleware);

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
  const spawnRepo =
    deps.spawnRepo ||
    (config.NODE_ENV === 'test' ? new InMemorySpawnRepository() : new PostgresSpawnRepository());
  const batchRepo =
    deps.batchRepo ||
    (config.NODE_ENV === 'test' ? new InMemoryBatchRepository() : new PostgresBatchRepository());
  const playerRepo =
    deps.playerRepo ||
    (config.NODE_ENV === 'test' ? new InMemoryPlayerRepository() : new PostgresPlayerRepository());
  const claimRepo =
    deps.claimRepo ||
    (config.NODE_ENV === 'test' && playerRepo instanceof InMemoryPlayerRepository
      ? new InMemoryClaimRepository()
      : new PostgresClaimRepository());
  const zoneRepo =
    deps.zoneRepo ||
    (config.NODE_ENV === 'test' && playerRepo instanceof InMemoryPlayerRepository
      ? new InMemoryZoneRepository()
      : new PostgresZoneRepository(dbPool));
  const rotationRepo = deps.rotationRepo || new InMemoryRotationRepository();
  const leaderboardRepo =
    deps.leaderboardRepo ||
    (config.NODE_ENV === 'test' && playerRepo instanceof InMemoryPlayerRepository
      ? new InMemoryLeaderboardRepository()
      : new PostgresLeaderboardRepository(dbPool));
  const oidcClient =
    deps.oidcClient ||
    new GoogleOidcClient(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_CALLBACK_URL);

  // Geospatial Service
  const geoService = deps.geoService || new PostgresGeospatialService(dbPool);

  // Audit Service (Privileged administrative mutation logging)
  const auditService =
    deps.auditService ||
    (config.NODE_ENV === 'test' && playerRepo instanceof InMemoryPlayerRepository
      ? new InMemoryAuditService()
      : new PostgresAuditService());

  // Authentication Service
  const authService = new AuthService(oidcClient, playerRepo, {
    collegeDomain: config.AUTH_COLLEGE_DOMAIN,
    jwtSecret: config.JWT_SECRET,
    jwtAccessExpirationSeconds: config.JWT_ACCESS_EXPIRATION_SECONDS,
    refreshTokenExpirationSeconds: config.REFRESH_TOKEN_EXPIRATION_SECONDS,
  });

  // Use Cases (Orchestration layer)
  const validateClaimUseCase = new ValidateClaimUseCase(
    spawnRepo,
    batchRepo,
    claimRepo,
    geoService
  );
  const claimSpawnUseCase =
    deps.claimSpawnUseCase ||
    new ClaimSpawnUseCase(geoService, deps.eventBus || eventBus, transactionManager);
  const getActiveSpawnsUseCase = new GetActiveSpawnsUseCase(spawnRepo);
  const getSpawnByIdUseCase = new GetSpawnByIdUseCase(spawnRepo);
  const listSpawnsUseCase = new ListSpawnsUseCase(spawnRepo);
  const adminCreateSpawnUseCase = new AdminCreateSpawnUseCase(spawnRepo, geoService, auditService);
  const adminEditSpawnUseCase = new AdminEditSpawnUseCase(spawnRepo, geoService, auditService);
  const adminManageSpawnsUseCase = new AdminManageSpawnsUseCase(spawnRepo, auditService);

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

  // Authoritative Batch Engine & Rotation Services
  const gameSettingsService = new GameSettingsService(dbPool);
  const generateBatchUseCase = new GenerateBatchUseCase(
    batchRepo,
    spawnRepo,
    geoService,
    gameSettingsService,
    dbPool
  );
  const activateBatchUseCase = new ActivateBatchUseCase(batchRepo);
  const expireBatchUseCase = new ExpireBatchUseCase(batchRepo);
  const getBatchByIdUseCase = new GetBatchByIdUseCase(batchRepo);

  const rotationService =
    deps.rotationService ||
    new RotationService(batchRepo, generateBatchUseCase, gameSettingsService, dbPool);

  const rotationScheduler =
    deps.rotationScheduler ||
    new RotationScheduler(rotationService);

  // Controllers (Driving HTTP Adapters - ZERO direct database access)
  const spawnController = new SpawnController(
    getActiveSpawnsUseCase,
    getSpawnByIdUseCase,
    listSpawnsUseCase
  );
  const claimController = new ClaimController(
    claimSpawnUseCase,
    getClaimsHistoryUseCase,
    validateClaimUseCase,
    deps.validateOnlyClaims || false
  );
  const playerController = new PlayerController(getPlayerProfileUseCase);
  const leaderboardController = new LeaderboardController(getLeaderboardUseCase);
  const zoneController = new ZoneController(getZonesUseCase, getZoneByIdUseCase);
  const adminController = new AdminController(
    adminManageSpawnsUseCase,
    rotateSpawnsUseCase,
    getAdminOverviewUseCase,
    adminCreateSpawnUseCase,
    adminEditSpawnUseCase,
    rotationService
  );
  const authController = new AuthController(authService);

  app.set('rotationService', rotationService);
  app.set('rotationScheduler', rotationScheduler);
  app.set('batchRepo', batchRepo);
  app.set('spawnRepo', spawnRepo);

  // 5. Mount API Routes under /api
  const apiRouter = createApiRouter({
    spawnController,
    claimController,
    playerController,
    leaderboardController,
    zoneController,
    adminController,
    authController,
    auditService,
  });

  app.use('/api', apiRouter);

  // 6. Catch-all Not Found Handler (forwards to errorHandler)
  app.use(notFoundHandler);

  // 7. Global Centralized Error Handler (RFC 7807 problem details)
  app.use(errorHandler);

  return app;
}
