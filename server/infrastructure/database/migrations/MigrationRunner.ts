import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Pool, PoolClient } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  fullPath: string;
  sql: string;
  checksum: string;
}

export interface MigrationRecord {
  version: string;
  name: string;
  applied_at: string;
  checksum: string;
}

export interface MigrationResult {
  appliedCount: number;
  applied: string[];
  alreadyAppliedCount: number;
}

export interface MigrationValidationResult {
  valid: boolean;
  errors: string[];
  pendingCount: number;
  appliedCount: number;
}

export class MigrationRunner {
  private readonly migrationsDir: string;
  // Unique 64-bit integer advisory lock key for Project I9 migrations
  private static readonly ADVISORY_LOCK_KEY = '849201948271';

  constructor(
    private readonly pool: Pool,
    migrationsDir?: string
  ) {
    this.migrationsDir = migrationsDir || path.resolve(__dirname, 'sql');
  }

  public async runMigrations(): Promise<MigrationResult> {
    const client: PoolClient = await this.pool.connect();

    try {
      // 1. Acquire transactional advisory lock to prevent concurrent runner races
      await client.query(`SELECT pg_advisory_lock(${MigrationRunner.ADVISORY_LOCK_KEY});`);

      // 2. Ensure schema_migrations table exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          checksum VARCHAR(64) NOT NULL
        );
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'i9_app_user') THEN
            GRANT SELECT ON schema_migrations TO i9_app_user;
          END IF;
        END $$;
      `);

      // 3. Fetch applied migrations
      const appliedRes = await client.query<MigrationRecord>(
        'SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC;'
      );
      const appliedMap = new Map<string, MigrationRecord>();
      for (const row of appliedRes.rows) {
        appliedMap.set(row.version, row);
      }

      // 4. Load migration files from disk
      const files = this.loadMigrationFiles();

      const newlyApplied: string[] = [];

      for (const file of files) {
        const existing = appliedMap.get(file.version);

        if (existing) {
          // Verify checksum has not changed (tamper check)
          if (existing.checksum !== file.checksum) {
            throw new Error(
              `[MigrationRunner] Checksum mismatch for migration "${file.version}" (${file.name}). ` +
              `Expected: ${existing.checksum}, Found on disk: ${file.checksum}. ` +
              `Applied migrations must not be modified.`
            );
          }
          continue;
        }

        // Apply new migration inside a transaction
        console.log(`[MigrationRunner] Applying migration ${file.version}: ${file.name}...`);
        await client.query('BEGIN;');

        try {
          await client.query(file.sql);
          await client.query(
            `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3);`,
            [file.version, file.name, file.checksum]
          );
          await client.query('COMMIT;');
          newlyApplied.push(file.version);
          console.log(`[MigrationRunner] Migration ${file.version} applied successfully.`);
        } catch (migrationErr) {
          await client.query('ROLLBACK;');
          console.error(`[MigrationRunner] Migration ${file.version} failed:`, migrationErr);
          throw migrationErr;
        }
      }

      return {
        appliedCount: newlyApplied.length,
        applied: newlyApplied,
        alreadyAppliedCount: appliedMap.size,
      };
    } finally {
      try {
        await client.query(`SELECT pg_advisory_unlock(${MigrationRunner.ADVISORY_LOCK_KEY});`);
      } catch (unlockErr) {
        console.warn('[MigrationRunner] Warning releasing advisory lock:', unlockErr);
      }
      client.release();
    }
  }

  public async validateMigrations(): Promise<MigrationValidationResult> {
    const client: PoolClient = await this.pool.connect();
    const errors: string[] = [];

    try {
      // Check if schema_migrations table exists
      const tableCheck = await client.query<{ exists: boolean }>(`
        SELECT (to_regclass('public.schema_migrations') IS NOT NULL) AS exists;
      `);

      if (!tableCheck.rows[0]?.exists) {
        return {
          valid: false,
          errors: ['schema_migrations table does not exist. Migrations have not been initialized.'],
          pendingCount: this.loadMigrationFiles().length,
          appliedCount: 0,
        };
      }

      const appliedRes = await client.query<MigrationRecord>(
        'SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC;'
      );
      const appliedMap = new Map<string, MigrationRecord>();
      for (const row of appliedRes.rows) {
        appliedMap.set(row.version, row);
      }

      const files = this.loadMigrationFiles();
      let pending = 0;

      for (const file of files) {
        const existing = appliedMap.get(file.version);
        if (!existing) {
          pending++;
        } else if (existing.checksum !== file.checksum) {
          errors.push(
            `Migration "${file.version}" (${file.name}) checksum altered after application.`
          );
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        pendingCount: pending,
        appliedCount: appliedMap.size,
      };
    } finally {
      client.release();
    }
  }

  public async getAppliedMigrations(): Promise<MigrationRecord[]> {
    const res = await this.pool.query<MigrationRecord>(
      'SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC;'
    );
    return res.rows;
  }

  private loadMigrationFiles(): MigrationFile[] {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    const fileNames = fs
      .readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    return fileNames.map((filename) => {
      const fullPath = path.join(this.migrationsDir, filename);
      const rawSql = fs.readFileSync(fullPath, 'utf-8');
      // Normalize CRLF to LF to guarantee identical checksums across Windows, Linux, and macOS
      const sql = rawSql.replace(/\r\n/g, '\n');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      // Filename convention: YYYYMMDDHHMMSS_description.sql
      const match = filename.match(/^(\d+)_(.+)\.sql$/);
      const version = match ? match[1] : filename;
      const name = match ? match[2] : filename;

      return {
        version,
        name,
        filename,
        fullPath,
        sql,
        checksum,
      };
    });
  }
}
