import { Pool, PoolConfig } from 'pg';
import { DatabaseConfig, IQueryResult, DatabaseHealthStatus, PostgisStatus } from './types';
import { normalizeDatabaseError } from './errors';

export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export class DatabasePool {
  private static instance: DatabasePool | null = null;
  private pool: Pool | null = null;
  private config: DatabaseConfig | null = null;

  private constructor() {}

  public static getInstance(): DatabasePool {
    if (!DatabasePool.instance) {
      DatabasePool.instance = new DatabasePool();
    }
    return DatabasePool.instance;
  }

  public initialize(config: DatabaseConfig): void {
    if (this.pool) {
      return; // Already initialized
    }

    this.config = config;

    const poolConfig: PoolConfig = {
      connectionString: config.connectionString,
      max: config.max,
      min: config.min,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      statement_timeout: config.statementTimeoutMillis,
    };

    this.pool = new Pool(poolConfig);

    this.pool.on('error', (err) => {
      console.error('[Database Pool Error]:', err.message);
    });
  }

  public getPool(): Pool {
    if (!this.pool) {
      throw new Error('[DatabasePool] Pool has not been initialized. Call initialize() first.');
    }
    return this.pool;
  }

  public getStats(): PoolStats {
    if (!this.pool) {
      return { totalCount: 0, idleCount: 0, waitingCount: 0 };
    }
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  public async query<T = Record<string, unknown>>(
    text: string,
    params: unknown[] = []
  ): Promise<IQueryResult<T>> {
    const pool = this.getPool();
    const start = Date.now();

    try {
      const res = await pool.query<any>(text, params);
      const duration = Date.now() - start;

      // Slow query audit logger
      if (duration > 1000) {
        console.warn(`[Database Slow Query Warning] (${duration}ms): ${text.substring(0, 100)}...`);
      }

      return {
        rows: res.rows as T[],
        rowCount: res.rowCount,
      };
    } catch (err) {
      throw normalizeDatabaseError(err);
    }
  }

  public async healthCheck(): Promise<DatabaseHealthStatus> {
    const pool = this.getPool();

    try {
      const basicRes = await pool.query('SELECT current_database() as db, NOW() as ts;');
      const currentDb = basicRes.rows[0].db;
      const timestamp = new Date(basicRes.rows[0].ts).toISOString();

      // Check PostGIS availability and installation
      const postgisStatus = await this.checkPostgisStatus();

      return {
        ok: true,
        timestamp,
        database: currentDb,
        postgis: postgisStatus,
      };
    } catch (err) {
      throw normalizeDatabaseError(err);
    }
  }

  public async checkPostgisStatus(): Promise<PostgisStatus> {
    const pool = this.getPool();

    try {
      // 1. Check if extension is installed in current database
      const installedRes = await pool.query(
        "SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis';"
      );

      if (installedRes.rowCount && installedRes.rowCount > 0) {
        try {
          const verRes = await pool.query('SELECT PostGIS_Full_Version() as ver;');
          return {
            isAvailable: true,
            isInstalled: true,
            version: installedRes.rows[0].extversion,
            details: verRes.rows[0].ver,
          };
        } catch {
          return {
            isAvailable: true,
            isInstalled: true,
            version: installedRes.rows[0].extversion,
          };
        }
      }

      // 2. Check if extension is available on the server
      const availRes = await pool.query(
        "SELECT name, default_version FROM pg_available_extensions WHERE name = 'postgis';"
      );

      if (availRes.rowCount && availRes.rowCount > 0) {
        return {
          isAvailable: true,
          isInstalled: false,
          version: availRes.rows[0].default_version,
          details: 'PostGIS extension is available on server and ready to be enabled via migration.',
        };
      }

      return {
        isAvailable: false,
        isInstalled: false,
        details: 'PostGIS extension is not installed in the PostgreSQL server extensions directory.',
      };
    } catch (err) {
      return {
        isAvailable: false,
        isInstalled: false,
        details: `Failed to query PostGIS status: ${(err as Error).message}`,
      };
    }
  }

  public async shutdown(): Promise<void> {
    if (this.pool) {
      console.log('[DatabasePool] Draining and closing database connection pool...');
      await this.pool.end();
      this.pool = null;
      console.log('[DatabasePool] Database connection pool closed successfully.');
    }
  }
}

export const dbPool = DatabasePool.getInstance();
