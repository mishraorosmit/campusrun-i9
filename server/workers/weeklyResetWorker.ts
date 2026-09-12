import { dbPool } from '../infrastructure/database';
import { PostgresWeeklyCycleRepository } from '../infrastructure/repositories/postgres/PostgresWeeklyCycleRepository';
import { PostgresLeaderboardRepository } from '../infrastructure/repositories/postgres/PostgresLeaderboardRepository';
import { TransactionManager } from '../infrastructure/database/transaction';
import { WeeklyCycleService } from '../services/WeeklyCycleService';
import { ResetWeeklyCycleUseCase } from '../services/ResetWeeklyCycleUseCase';
import { WeeklyResetScheduler } from '../services/WeeklyResetScheduler';
import { config } from '../config';

// 1. Initialize Database Pool
dbPool.initialize({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  min: config.DB_POOL_MIN,
  idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
  statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT_MS,
});

// 2. Instantiate Repositories and Services
const pool = dbPool.getPool();
const weeklyCycleRepo = new PostgresWeeklyCycleRepository(pool);
const leaderboardRepo = new PostgresLeaderboardRepository(pool);
const txManager = new TransactionManager();

const weeklyCycleService = new WeeklyCycleService(weeklyCycleRepo, leaderboardRepo, txManager);
const resetWeeklyCycleUseCase = new ResetWeeklyCycleUseCase(weeklyCycleService);

const scheduler = new WeeklyResetScheduler(weeklyCycleRepo, resetWeeklyCycleUseCase, {
  checkIntervalMs: 30000, // Check every 30 seconds
  autoStart: true,
});

console.log('====================================================');
console.log('  Campus Run — Weekly Reset Scheduler Worker Active');
console.log(`  Check Interval: 30 seconds`);
console.log('====================================================');

// Initial check on boot
scheduler.checkAndExecuteReset().then((res) => {
  console.log(`[WeeklyResetWorker] Boot check: ${res.reason}`);
}).catch((err) => {
  console.error('[WeeklyResetWorker] Error on initial check:', err);
});

// Graceful Shutdown
function handleShutdown(signal: string) {
  console.log(`[WeeklyResetWorker] Received ${signal}. Stopping scheduler...`);
  scheduler.stop();
  dbPool.shutdown().then(() => {
    console.log('[WeeklyResetWorker] Database connections closed.');
    process.exit(0);
  }).catch((err) => {
    console.error('[WeeklyResetWorker] Error during shutdown:', err);
    process.exit(1);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
