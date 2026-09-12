import { Pool } from 'pg';
import dotenv from 'dotenv';
import { MigrationRunner } from './MigrationRunner';

dotenv.config();

async function runCli() {
  // Use dedicated MIGRATION_DATABASE_URL or fallback to DATABASE_URL / default migrator credentials
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://i9_migrator:i9_migrator_password@localhost:5432/campus_run';

  console.log('====================================================');
  console.log('  Project I9 Database Migration Runner');
  console.log('====================================================');

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
  });

  try {
    const runner = new MigrationRunner(pool);
    const result = await runner.runMigrations();

    console.log('----------------------------------------------------');
    console.log(`  Previously applied: ${result.alreadyAppliedCount}`);
    console.log(`  Newly applied:      ${result.appliedCount}`);
    if (result.applied.length > 0) {
      console.log(`  Applied versions:   ${result.applied.join(', ')}`);
    }
    console.log('  Database schema is up to date.');
    console.log('====================================================');

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('[Migration Error]:', err);
    await pool.end();
    process.exit(1);
  }
}

runCli();
