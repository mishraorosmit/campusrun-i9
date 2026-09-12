import { config } from './config';
import { createApp } from './app';
import { dbPool } from './infrastructure/database';

// Initialize Database Pool
dbPool.initialize({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  min: config.DB_POOL_MIN,
  idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: config.DB_CONNECT_TIMEOUT_MS,
  statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT_MS,
});

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log('====================================================');
  console.log(`  Project I9 Backend — Active & Ready`);
  console.log(`  Mode:         ${config.NODE_ENV}`);
  console.log(`  Port:         ${config.PORT}`);
  console.log(`  API Base:     http://localhost:${config.PORT}${config.API_PREFIX}`);
  console.log(`  Health Check: http://localhost:${config.PORT}/api/health`);
  console.log('====================================================');
});

// Graceful Shutdown
async function handleShutdown(signal: string) {
  console.log(`[I9 Server] Received ${signal}. Shutting down gracefully...`);

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
