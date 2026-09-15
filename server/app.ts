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
  InMemoryWeeklyCycleRepository,
  InMemoryNotificationRepository,
  InMemoryPushSubscriptionRepository,
  InMemoryAnalyticsRepository,
  PostgresSpawnRepository,
  PostgresBatchRepository,
  PostgresPlayerRepository,
  PostgresNotificationRepository,
  PostgresPushSubscriptionRepository,
  PostgresAnalyticsRepository,
  PostgresAuditService,
  InMemoryAuditService,
  PostgresGeospatialService,
  dbPool,
  geoCalculator,
} from './infrastructure';

// PostgreSQL transaction support
import { TransactionManager, InMemoryTransactionManager } from './infrastructure/database/transaction';
import { dbPool as dbPoolInstance } from './infrastructure/database/pool';
import { PostgresClaimRepository } from './infrastructure/repositories/postgres/PostgresClaimRepository';
import { PostgresLeaderboardRepository } from './infrastructure/repositories/postgres/PostgresLeaderboardRepository';
import { PostgresWeeklyCycleRepository } from './infrastructure/repositories/postgres/PostgresWeeklyCycleRepository';
import { PostgresZoneRepository } from './infrastructure/repositories/postgres/PostgresZoneRepository';

// Google OIDC Client
import { GoogleOidcClient } from './infrastructure/auth/GoogleOidcClient';

// Event Bus & Handlers
import {
  eventBus,
  IEventBus,
  NotificationPersistenceHandler,
  DatabaseNotificationHandler,
  RealtimeEventHandler,
  WebPushHandler,
  AnalyticsHandler,
} from './events';

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

  ResetWeeklyLeaderboardUseCase,
  WeeklyCycleService,
  GetNextWeeklyResetUseCase,
  ResetWeeklyCycleUseCase,
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
  UpdatePlayerPreferencesUseCase,
  GetPlayerStatsUseCase,
  GetPlayerNotificationsUseCase,
  GetUnreadNotificationCountUseCase,
  MarkNotificationAsReadUseCase,
  MarkAllNotificationsReadUseCase,
  SavePushSubscriptionUseCase,
  DeletePushSubscriptionUseCase,
  GetGameStateUseCase,
  GetGameRotationUseCase,
  IRealtimeService,
  realtimeService,
  PushDeliveryService,
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
  NotificationController,
  PushSubscriptionController,
  GameController,
} from './controllers';

import {
  ISpawnRepository,
  IBatchRepository,
  IPlayerRepository,
  IClaimRepository,
  IZoneRepository,
  ILeaderboardRepository,
  IWeeklyCycleRepository,
  INotificationRepository,
  IPushSubscriptionRepository,
  IAnalyticsRepository,
  IRotationRepository,
} from './repositories';

export interface AppDependencies {
  spawnRepo?: ISpawnRepository;
  batchRepo?: IBatchRepository;
  playerRepo?: IPlayerRepository;
  claimRepo?: IClaimRepository;
  zoneRepo?: IZoneRepository;
  rotationRepo?: IRotationRepository;
  leaderboardRepo?: ILeaderboardRepository;
  weeklyCycleRepo?: IWeeklyCycleRepository;
  notificationRepo?: INotificationRepository;
  pushSubscriptionRepo?: IPushSubscriptionRepository;
  analyticsRepo?: IAnalyticsRepository;
  pushDeliveryService?: PushDeliveryService;
  oidcClient?: GoogleOidcClient;
  auditService?: IAuditService;
  geoService?: IGeospatialService;
  realtimeService?: IRealtimeService;
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
  const isTest = config.NODE_ENV === 'test' || !dbPool.isInitialized();
  const getPool = () => (dbPool.isInitialized() ? dbPool.getPool() : (null as any));

  const spawnRepo = deps.spawnRepo || (isTest ? new InMemorySpawnRepository() : new PostgresSpawnRepository(getPool()));
  const batchRepo =
    deps.batchRepo ||
    (isTest ? new InMemoryBatchRepository() : new PostgresBatchRepository());
  const playerRepo = deps.playerRepo || (isTest ? new InMemoryPlayerRepository() : new PostgresPlayerRepository(getPool()));
  const claimRepo = deps.claimRepo || new InMemoryClaimRepository();
  const zoneRepo =
    deps.zoneRepo ||
    (isTest ? new InMemoryZoneRepository() : new PostgresZoneRepository(dbPool));
  const rotationRepo = deps.rotationRepo || new InMemoryRotationRepository();
  const leaderboardRepo = deps.leaderboardRepo || (isTest ? new InMemoryLeaderboardRepository() : new PostgresLeaderboardRepository(getPool()));
  const weeklyCycleRepo = deps.weeklyCycleRepo || (isTest ? new InMemoryWeeklyCycleRepository() : new PostgresWeeklyCycleRepository(getPool()));
  const notificationRepo =
    deps.notificationRepo ||
    (isTest
      ? new InMemoryNotificationRepository()
      : new PostgresNotificationRepository(getPool()));
  const pushSubscriptionRepo =
    deps.pushSubscriptionRepo ||
    (isTest
      ? new InMemoryPushSubscriptionRepository()
      : new PostgresPushSubscriptionRepository(getPool()));
  const analyticsRepo =
    deps.analyticsRepo ||
    (isTest
      ? new InMemoryAnalyticsRepository()
      : new PostgresAnalyticsRepository(getPool()));

  const oidcClient =
    deps.oidcClient ||
    new GoogleOidcClient(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_CALLBACK_URL);

  // Geospatial Service
  const geoService = deps.geoService || new PostgresGeospatialService(dbPool);

  // Audit Service (Privileged administrative mutation logging)
  const auditService =
    deps.auditService ||
    (isTest
      ? new InMemoryAuditService()
      : new PostgresAuditService());

  // Authentication Service
  const authService = new AuthService(oidcClient, playerRepo, {
    collegeDomain: config.AUTH_COLLEGE_DOMAIN,
    jwtSecret: config.JWT_SECRET,
    jwtAccessExpirationSeconds: config.JWT_ACCESS_EXPIRATION_SECONDS,
    refreshTokenExpirationSeconds: config.REFRESH_TOKEN_EXPIRATION_SECONDS,
  });

  const txManager = isTest || !dbPool.isInitialized() ? new InMemoryTransactionManager() : new TransactionManager();
  const pgClaimRepo = isTest || deps.claimRepo ? (claimRepo as any) : new PostgresClaimRepository(getPool());
  const pgPlayerRepo = isTest || deps.playerRepo ? (playerRepo as any) : new PostgresPlayerRepository(getPool());
  const rtService = deps.realtimeService || realtimeService;
  const eBus = deps.eventBus || eventBus;

  // Use Cases (Orchestration layer)
  const validateClaimUseCase = new ValidateClaimUseCase(
    spawnRepo,
    batchRepo,
    claimRepo,
    geoService
  );
  const claimSpawnUseCase =
    deps.claimSpawnUseCase ||
    new ClaimSpawnUseCase(
      spawnRepo,
      pgPlayerRepo,
      pgClaimRepo,
      leaderboardRepo,
      geoCalculator,
      eBus,
      txManager,
      rtService
    );
  const getActiveSpawnsUseCase = new GetActiveSpawnsUseCase(spawnRepo);
  const getSpawnByIdUseCase = new GetSpawnByIdUseCase(spawnRepo);
  const listSpawnsUseCase = new ListSpawnsUseCase(spawnRepo);
  const adminCreateSpawnUseCase = new AdminCreateSpawnUseCase(spawnRepo, geoService, auditService);
  const adminEditSpawnUseCase = new AdminEditSpawnUseCase(spawnRepo, geoService, auditService);

  const rotateSpawnsUseCase = new RotateSpawnsUseCase(
    rotationRepo,
    spawnRepo,
    eBus,
    {
      rotationIntervalMinutes: config.ROTATION_INTERVAL_MINUTES,
      concurrentActiveSpawns: config.CONCURRENT_ACTIVE_SPAWNS,
    },
    rtService
  );
  const getLeaderboardUseCase = new GetLeaderboardUseCase(leaderboardRepo);
  const getPlayerProfileUseCase = new GetPlayerProfileUseCase(playerRepo);
  const updatePlayerPreferencesUseCase = new UpdatePlayerPreferencesUseCase(playerRepo);
  const getPlayerStatsUseCase = new GetPlayerStatsUseCase(playerRepo, leaderboardRepo);
  const getClaimsHistoryUseCase = new GetClaimsHistoryUseCase(claimRepo);
  const getPlayerNotificationsUseCase = new GetPlayerNotificationsUseCase(notificationRepo);
  const getUnreadNotificationCountUseCase = new GetUnreadNotificationCountUseCase(notificationRepo);
  const markNotificationAsReadUseCase = new MarkNotificationAsReadUseCase(notificationRepo);
  const markAllNotificationsReadUseCase = new MarkAllNotificationsReadUseCase(notificationRepo);
  const savePushSubscriptionUseCase = new SavePushSubscriptionUseCase(pushSubscriptionRepo);
  const deletePushSubscriptionUseCase = new DeletePushSubscriptionUseCase(pushSubscriptionRepo);
  const getZonesUseCase = new GetZonesUseCase(zoneRepo);
  const getZoneByIdUseCase = new GetZoneByIdUseCase(zoneRepo);
  const getAdminOverviewUseCase = new GetAdminOverviewUseCase(spawnRepo, claimRepo);
  const adminManageSpawnsUseCase = new AdminManageSpawnsUseCase(spawnRepo, rtService, eBus, auditService);
  const resetWeeklyLeaderboardUseCase = new ResetWeeklyLeaderboardUseCase(leaderboardRepo);
  const weeklyCycleService = new WeeklyCycleService(weeklyCycleRepo, leaderboardRepo, txManager, rtService, eBus);
  const getNextWeeklyResetUseCase = new GetNextWeeklyResetUseCase(weeklyCycleService);
  const resetWeeklyCycleUseCase = new ResetWeeklyCycleUseCase(weeklyCycleService);
  const getGameStateUseCase = new GetGameStateUseCase(spawnRepo, weeklyCycleRepo);
  const getGameRotationUseCase = new GetGameRotationUseCase(rotationRepo, spawnRepo);

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

  // Internal Domain Event Handlers (Fan-out: Database Notifications, Socket.IO Realtime, Web Push, Analytics)
  const pushDeliveryService =
    deps.pushDeliveryService ||
    new PushDeliveryService(pushSubscriptionRepo, playerRepo);

  new NotificationPersistenceHandler(eBus, notificationRepo, playerRepo);
  new RealtimeEventHandler(eBus, rtService);
  new WebPushHandler(eBus, pushSubscriptionRepo, pushDeliveryService, playerRepo);
  new AnalyticsHandler(eBus, analyticsRepo);

  // Controllers (Driving HTTP Adapters - ZERO repository dependencies)
  const spawnController = new SpawnController(getActiveSpawnsUseCase, getSpawnByIdUseCase, listSpawnsUseCase);
  const claimController = new ClaimController(
    claimSpawnUseCase,
    getClaimsHistoryUseCase,
    validateClaimUseCase,
    deps.validateOnlyClaims || false
  );
  const playerController = new PlayerController(
    getPlayerProfileUseCase,
    updatePlayerPreferencesUseCase,
    getPlayerStatsUseCase,
    getClaimsHistoryUseCase
  );
  const leaderboardController = new LeaderboardController(getLeaderboardUseCase);
  const zoneController = new ZoneController(getZonesUseCase, getZoneByIdUseCase);
  const adminController = new AdminController(
    adminManageSpawnsUseCase,
    rotateSpawnsUseCase,
    getAdminOverviewUseCase,
    resetWeeklyLeaderboardUseCase,
    resetWeeklyCycleUseCase,
    weeklyCycleRepo,
    adminCreateSpawnUseCase,
    adminEditSpawnUseCase,
    rotationService
  );
  const authController = new AuthController(authService);
  const weeklyCycleController = new WeeklyCycleController(getNextWeeklyResetUseCase);
  const notificationController = new NotificationController(
    getPlayerNotificationsUseCase,
    markNotificationAsReadUseCase,
    getUnreadNotificationCountUseCase,
    markAllNotificationsReadUseCase
  );
  const pushSubscriptionController = new PushSubscriptionController(
    savePushSubscriptionUseCase,
    deletePushSubscriptionUseCase
  );
  const gameController = new GameController(
    getGameStateUseCase,
    getGameRotationUseCase
  );

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
    weeklyCycleController,
    notificationController,
    pushSubscriptionController,
    gameController,
    auditService,
  });

  app.use('/api', apiRouter);

  // 6. Catch-all Not Found Handler (forwards to errorHandler)
  app.use(notFoundHandler);

  // 7. Global Centralized Error Handler (RFC 7807 problem details)
  app.use(errorHandler);

  return app;
}
