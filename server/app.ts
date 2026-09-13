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
  PostgresPlayerRepository,
  PostgresNotificationRepository,
  PostgresPushSubscriptionRepository,
  PostgresAnalyticsRepository,
  PostgresAuditService,
  InMemoryAuditService,
  geoCalculator,
} from './infrastructure';

// PostgreSQL transaction support
import { TransactionManager, InMemoryTransactionManager } from './infrastructure/database/transaction';
import { dbPool } from './infrastructure/database/pool';
import { PostgresClaimRepository } from './infrastructure/repositories/postgres/PostgresClaimRepository';
import { PostgresLeaderboardRepository } from './infrastructure/repositories/postgres/PostgresLeaderboardRepository';
import { PostgresWeeklyCycleRepository } from './infrastructure/repositories/postgres/PostgresWeeklyCycleRepository';

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
  IAuditService,
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
  ILeaderboardRepository,
  IWeeklyCycleRepository,
  IPlayerRepository,
  INotificationRepository,
  IPushSubscriptionRepository,
  IAnalyticsRepository,
  IRotationRepository,
} from './repositories';

export interface AppDependencies {
  spawnRepo?: ISpawnRepository;
  playerRepo?: IPlayerRepository;
  claimRepo?: InMemoryClaimRepository;
  zoneRepo?: InMemoryZoneRepository;
  rotationRepo?: IRotationRepository;
  leaderboardRepo?: ILeaderboardRepository;
  weeklyCycleRepo?: IWeeklyCycleRepository;
  notificationRepo?: INotificationRepository;
  pushSubscriptionRepo?: IPushSubscriptionRepository;
  pushDeliveryService?: PushDeliveryService;
  analyticsRepo?: IAnalyticsRepository;
  oidcClient?: GoogleOidcClient;
  auditService?: IAuditService;
  realtimeService?: IRealtimeService;
  eventBus?: IEventBus;
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
  const playerRepo = deps.playerRepo || (isTest ? new InMemoryPlayerRepository() : new PostgresPlayerRepository(getPool()));
  const claimRepo = deps.claimRepo || new InMemoryClaimRepository();
  const zoneRepo = deps.zoneRepo || new InMemoryZoneRepository();
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
  const claimSpawnUseCase = new ClaimSpawnUseCase(
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
  const adminManageSpawnsUseCase = new AdminManageSpawnsUseCase(spawnRepo, rtService, eBus);
  const resetWeeklyLeaderboardUseCase = new ResetWeeklyLeaderboardUseCase(leaderboardRepo);
  const weeklyCycleService = new WeeklyCycleService(weeklyCycleRepo, leaderboardRepo, txManager, rtService, eBus);
  const getNextWeeklyResetUseCase = new GetNextWeeklyResetUseCase(weeklyCycleService);
  const resetWeeklyCycleUseCase = new ResetWeeklyCycleUseCase(weeklyCycleService);
  const getGameStateUseCase = new GetGameStateUseCase(spawnRepo, weeklyCycleRepo);
  const getGameRotationUseCase = new GetGameRotationUseCase(rotationRepo, spawnRepo);

  // Internal Domain Event Handlers (Fan-out: Database Notifications, Socket.IO Realtime, Web Push, Analytics)
  const pushDeliveryService =
    deps.pushDeliveryService ||
    new PushDeliveryService(pushSubscriptionRepo, playerRepo);

  new NotificationPersistenceHandler(eBus, notificationRepo, playerRepo);
  new RealtimeEventHandler(eBus, rtService);
  new WebPushHandler(eBus, pushSubscriptionRepo, pushDeliveryService, playerRepo);
  new AnalyticsHandler(eBus, analyticsRepo);

  // Controllers (Driving HTTP Adapters - ZERO repository dependencies)
  const spawnController = new SpawnController(getActiveSpawnsUseCase, getSpawnByIdUseCase);
  const claimController = new ClaimController(claimSpawnUseCase, getClaimsHistoryUseCase);
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
    weeklyCycleRepo
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

  // Audit Service (Privileged administrative mutation logging)
  const auditService =
    deps.auditService ||
    (config.NODE_ENV === 'test' && playerRepo instanceof InMemoryPlayerRepository
      ? new InMemoryAuditService()
      : new PostgresAuditService());

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
