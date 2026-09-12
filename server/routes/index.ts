import { Router } from 'express';
import { createV1Router, V1Controllers } from './v1';
import { dbPool } from '../infrastructure/database';

export function createApiRouter(controllers: V1Controllers): Router {
  const router = Router();

  // Comprehensive Health Check endpoint including DB probe
  router.get('/health', async (_req, res) => {
    let dbStatus: unknown = null;
    try {
      dbStatus = await dbPool.healthCheck();
    } catch (err) {
      dbStatus = { ok: false, error: (err as Error).message };
    }

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: dbStatus,
    });
  });

  // Mount API v1
  router.use('/v1', createV1Router(controllers));

  return router;
}

export * from './v1';
