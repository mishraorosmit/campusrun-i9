import http from 'http';
import { config } from './config';
import { createApp } from './app';
import { dbPool } from './infrastructure/database';
import { PostgresWeeklyCycleRepository } from './infrastructure/repositories/postgres/PostgresWeeklyCycleRepository';
import { PostgresLeaderboardRepository } from './infrastructure/repositories/postgres/PostgresLeaderboardRepository';
import { TransactionManager } from './infrastructure/database/transaction';
import { WeeklyCycleService } from './services/WeeklyCycleService';
import { ResetWeeklyCycleUseCase } from './services/ResetWeeklyCycleUseCase';
import { WeeklyResetScheduler } from './services/WeeklyResetScheduler';
import { initSocketServer, closeSocketServer } from './realtime';

// 1. Initialize Database Pool
dbPool.initialize({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  min: config.DB_POOL_MIN,
  idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
  statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT_MS,
});

export const app = createApp();
export const httpServer = http.createServer(app);

// Initialize Socket.IO Realtime Engine
export const io = initSocketServer(httpServer);

// 2. Initialize Weekly Reset Scheduler
const pool = dbPool.getPool();
const weeklyCycleRepo = new PostgresWeeklyCycleRepository(pool);
const leaderboardRepo = new PostgresLeaderboardRepository(pool);
const txManager = new TransactionManager();

const weeklyCycleService = new WeeklyCycleService(weeklyCycleRepo, leaderboardRepo, txManager);
const resetWeeklyCycleUseCase = new ResetWeeklyCycleUseCase(weeklyCycleService);

const weeklyResetScheduler = new WeeklyResetScheduler(weeklyCycleRepo, resetWeeklyCycleUseCase, {
  checkIntervalMs: 60000,
  autoStart: config.NODE_ENV !== 'test',
});

export const server = httpServer.listen(config.PORT, () => {
  console.log('====================================================');
  console.log(`  Project I9 Backend — Active & Ready`);
  console.log(`  Mode:         ${config.NODE_ENV}`);
  console.log(`  Port:         ${config.PORT}`);
  console.log(`  API Base:     http://localhost:${config.PORT}${config.API_PREFIX}`);
  console.log(`  Health Check: http://localhost:${config.PORT}/api/health`);
  console.log(`  Realtime WS:  Socket.IO Active`);
  console.log(`  Weekly Reset: Scheduler Active (${weeklyResetScheduler.isRunning() ? 'Running' : 'Stopped'})`);
  console.log('====================================================');
});

// Graceful Shutdown
async function handleShutdown(signal: string) {
  console.log(`[I9 Server] Received ${signal}. Shutting down gracefully...`);

  // Stop background scheduler
  weeklyResetScheduler.stop();

  // Close Socket.IO server
  await closeSocketServer();

  // Stop accepting new HTTP requests
  server.close(async () => {
    console.log('[I9 Server] Closed HTTP server.');

    try {
      // Drain and close database connection pool
      await dbPool.shutdown();
      console.log('[I9 Server] Database pool drained.');
      process.exit(0);
    } catch (dbErr) {
      console.error('[I9 Server] Error during database shutdown:', dbErr);
      process.exit(1);
    }
  });

  // Force close after 10s if hanging
  setTimeout(() => {
    console.error('[I9 Server] Forced shutdown timeout exceeded.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
