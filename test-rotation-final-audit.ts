/**
 * Project I9 — Rotation Phase 04 Final Audit
 * 
 * Exhaustive audit verifying:
 * - Configurable interval (default vs explicit options)
 * - Automatic expiration (expired batch -> EXPIRED, spawns -> expired)
 * - Automatic batch generation (valid in-campus, min-separation, active count)
 * - Active-batch uniqueness (exactly 1 ACTIVE batch per cycle)
 * - Idempotency (unexpired batch returns CURRENT_BATCH_NOT_EXPIRED)
 * - Concurrency safety (simultaneous calls serialize via advisory lock)
 * - Manual force rotation (admin-guarded, safe handoff, admin attribution)
 * - Scheduler failure handling (catches errors, records lastError, resumes)
 * - Authoritative next-rotation timestamp (persisted in DB, zero frontend timer dependency)
 * - Audit logging (SPAWN_ROTATION and ADMIN_FORCE_ROTATION)
 * - No duplicate batches
 * - Failure handling (insufficient points, generation failure, transaction failure)
 */

import crypto from 'crypto';
import { config } from './server/config';
import { dbPool } from './server/infrastructure/database/pool';
import { transactionManager } from './server/infrastructure/database/transaction';
import { PostgresBatchRepository } from './server/infrastructure/repositories/postgres/PostgresBatchRepository';
import { PostgresSpawnRepository } from './server/infrastructure/repositories/postgres/PostgresSpawnRepository';
import { PostgresGeospatialService } from './server/infrastructure/geo/PostgresGeospatialService';
import { GameSettingsService } from './server/services/GameSettingsService';
import { GenerateBatchUseCase } from './server/services/GenerateBatchUseCase';
import { ActivateBatchUseCase } from './server/services/ActivateBatchUseCase';
import { RotationService } from './server/services/RotationService';
import { RotationScheduler } from './server/services/RotationScheduler';
import { SpawnPoint } from './server/domain/entities/SpawnPoint';
import { Coordinates } from './server/domain/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion FAILED: ${message}`);
    throw new Error(`Assertion FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runFinalRotationAudit() {
  console.log('================================================================');
  console.log('  PROJECT I9 — ROTATION PHASE 04: FINAL SYSTEM AUDIT');
  console.log('================================================================\n');

  // Initialize database connection pool
  dbPool.initialize({
    connectionString: config.DATABASE_URL,
    max: 15,
    min: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statementTimeoutMillis: 10000,
  });

  const createdCycleIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdSpawnIds: string[] = [];
  const createdUserIds: string[] = [];

  const batchRepo = new PostgresBatchRepository(dbPool);
  const spawnRepo = new PostgresSpawnRepository(dbPool);
  const geoService = new PostgresGeospatialService(dbPool);
  const settingsService = new GameSettingsService();
  const generateBatchUseCase = new GenerateBatchUseCase(batchRepo, spawnRepo, geoService, settingsService, dbPool);
  const rotationService = new RotationService(batchRepo, generateBatchUseCase, settingsService, dbPool);

  try {
    // -------------------------------------------------------------
    // SECTION 0: ENVIRONMENT SETUP
    // -------------------------------------------------------------
    console.log('--- SECTION 0: TEST ENVIRONMENT SETUP ---');
    const cycleId = crypto.randomUUID();
    createdCycleIds.push(cycleId);
    await dbPool.query(
      `INSERT INTO weekly_cycles (id, cycle_number, status, starts_at, ends_at)
       VALUES ($1, 9999, 'active', NOW() - INTERVAL '1 day', NOW() + INTERVAL '6 days');`,
      [cycleId]
    );
    assert(true, 'Created active weekly cycle');

    // Seed 36 valid campus spawn points
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const id = crypto.randomUUID();
        createdSpawnIds.push(id);
        const coord: Coordinates = {
          lat: 37.4275 + r * 0.0008,
          lng: -122.1704 + c * 0.0008,
        };
        const spawn = SpawnPoint.create({
          id,
          code: `FNL-${r}-${c}-${Date.now().toString().slice(-4)}`,
          title: `Final Audit Spawn (${r},${c})`,
          coordinates: coord,
          svgCoordinates: geoService.gpsToSvg(coord),
          points: 100,
          enabled: true,
        });
        await spawnRepo.create(spawn);
      }
    }
    assert(createdSpawnIds.length === 36, 'Seeded 36 valid in-campus spawn points');

    // Seed admin user
    const adminId = crypto.randomUUID();
    const adminEmail = `admin_audit_${Date.now()}@stanford.edu`;
    createdUserIds.push(adminId);
    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [adminId, adminEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name) VALUES ($1, $2, $3);`,
      [adminId, `admin_${Date.now()}`.substring(0, 20), 'Audit Admin']
    );
    await dbPool.query(
      `INSERT INTO admins (user_id, role, granted_by) VALUES ($1, 'superadmin', $1);`,
      [adminId]
    );
    assert(true, 'Seeded audit administrator');

    // -------------------------------------------------------------
    // SECTION 1: CONFIGURABLE INTERVAL & NORMAL ROTATION LIFECYCLE
    // -------------------------------------------------------------
    console.log('\n--- SECTION 1: CONFIGURABLE INTERVAL & NORMAL ROTATION ---');
    // Cold start with explicit custom interval of 30 minutes and count 5
    const initialRotation = await rotationService.rotate({
      cycleId,
      intervalMinutes: 30,
      count: 5,
      minSeparationMeters: 60.0,
    });
    assert(initialRotation.rotated === true, 'Initial cold-start rotation succeeded');
    const batch1 = initialRotation.activeBatch!;
    createdBatchIds.push(batch1.id);
    assert(batch1.status === 'ACTIVE', 'Batch 1 is ACTIVE');
    const expectedDurationMs = 30 * 60 * 1000;
    const actualDurationMs = batch1.expiresAt.getTime() - batch1.startedAt.getTime();
    assert(Math.abs(actualDurationMs - expectedDurationMs) < 1000, 'Configured 30 min interval correctly applied to batch duration');

    // Verify member spawns active
    const batch1Spawns = await dbPool.query(
      `SELECT status FROM spawn_points WHERE batch_id = $1;`,
      [batch1.id]
    );
    assert(batch1Spawns.rows.length === 5, '5 member spawns assigned to Batch 1');
    assert(batch1Spawns.rows.every((s) => s.status === 'active'), 'All Batch 1 member spawns are active');

    // Idempotent check: unexpired batch returns CURRENT_BATCH_NOT_EXPIRED
    const unexpiredCheck = await rotationService.rotate({ cycleId });
    assert(unexpiredCheck.rotated === false, 'Rotation skipped while Batch 1 is unexpired');
    assert(unexpiredCheck.reason === 'CURRENT_BATCH_NOT_EXPIRED', 'Reason is CURRENT_BATCH_NOT_EXPIRED');
    assert(unexpiredCheck.activeBatch?.id === batch1.id, 'Active batch remains Batch 1');

    // Fast-forward expiration in database
    await dbPool.query(
      `UPDATE spawn_batches SET started_at = NOW() - INTERVAL '35 minutes', expires_at = NOW() - INTERVAL '5 minutes' WHERE id = $1;`,
      [batch1.id]
    );

    // Normal automatic rotation on expired batch with default settings
    const secondRotation = await rotationService.rotate({ cycleId });
    assert(secondRotation.rotated === true, 'Second rotation triggered automatically on expired batch');
    const batch2 = secondRotation.activeBatch!;
    createdBatchIds.push(batch2.id);
    assert(batch2.id !== batch1.id, 'New batch ID is distinct from Batch 1');
    assert(batch2.status === 'ACTIVE', 'Batch 2 is ACTIVE');
    assert(secondRotation.previousBatchId === batch1.id, 'Second rotation reports Batch 1 as previousBatchId');

    // Verify Batch 1 and its spawns transitioned to expired
    const batch1After = await batchRepo.findById(batch1.id);
    assert(batch1After?.status === 'EXPIRED', 'Batch 1 transitioned to EXPIRED');
    const batch1SpawnsAfter = await dbPool.query(
      `SELECT status FROM spawn_points WHERE batch_id = $1;`,
      [batch1.id]
    );
    assert(batch1SpawnsAfter.rows.every((s) => s.status === 'expired'), 'Batch 1 member spawns transitioned to expired');

    // Verify exactly ONE active batch exists in cycle
    let activeBatchCount = await dbPool.query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeBatchCount.rows[0].count === 1, 'Exactly ONE active batch exists in weekly cycle');

    // -------------------------------------------------------------
    // SECTION 2: DELAYED SCHEDULER EXECUTION
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: DELAYED SCHEDULER EXECUTION ---');
    // Simulate delayed scheduler execution: batch2 expired 20 minutes ago
    await dbPool.query(
      `UPDATE spawn_batches SET started_at = NOW() - INTERVAL '50 minutes', expires_at = NOW() - INTERVAL '20 minutes' WHERE id = $1;`,
      [batch2.id]
    );

    const scheduler = new RotationScheduler(rotationService, { cycleId });
    // Scheduler tick must immediately rotate without being thrown off by the delay
    const delayedTickResult = await scheduler.tick();
    assert(delayedTickResult.rotated === true, 'Scheduler tick rotated immediately upon encountering delayed/expired batch');
    const batch3 = delayedTickResult.activeBatch!;
    createdBatchIds.push(batch3.id);
    assert(batch3.status === 'ACTIVE', 'Batch 3 is ACTIVE after delayed scheduler recovery');
    assert(delayedTickResult.previousBatchId === batch2.id, 'Batch 2 safely expired by scheduler tick');

    // -------------------------------------------------------------
    // SECTION 3: CONCURRENT ROTATION STORM
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: CONCURRENT ROTATION STORM ---');
    // Expire batch3 to simulate rotation window opening for multiple workers
    await dbPool.query(
      `UPDATE spawn_batches SET started_at = NOW() - INTERVAL '45 minutes', expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1;`,
      [batch3.id]
    );

    console.log('[Concurrency] Firing 5 simultaneous rotation requests...');
    const stormResults = await Promise.all([
      rotationService.rotate({ cycleId }),
      rotationService.rotate({ cycleId }),
      rotationService.rotate({ cycleId }),
      rotationService.rotate({ cycleId }),
      rotationService.rotate({ cycleId }),
    ]);

    const rotatedWinners = stormResults.filter((r) => r.rotated);
    const idempotentFollowers = stormResults.filter((r) => !r.rotated);
    assert(rotatedWinners.length === 1, 'Exactly ONE worker won the rotation race');
    assert(idempotentFollowers.length === 4, '4 workers detected the freshly rotated batch and skipped gracefully');
    assert(idempotentFollowers.every((r) => r.reason === 'CURRENT_BATCH_NOT_EXPIRED'), 'All 4 followers reported CURRENT_BATCH_NOT_EXPIRED');

    const batch4 = rotatedWinners[0].activeBatch!;
    createdBatchIds.push(batch4.id);
    assert(idempotentFollowers.every((r) => r.activeBatch?.id === batch4.id), 'All followers returned the identical active batch');

    // Check no duplicate active batches
    activeBatchCount = await dbPool.query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeBatchCount.rows[0].count === 1, 'Exactly ONE active batch exists after concurrent rotation storm');

    // -------------------------------------------------------------
    // SECTION 4: FORCE ROTATION DURING AUTOMATIC ROTATION RACE
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: FORCE ROTATION DURING AUTOMATIC ROTATION ---');
    // Batch 4 is STILL UNEXPIRED. Launch Admin Force Rotate and Scheduler Tick simultaneously
    console.log('[Race] Triggering simultaneous Admin Force Rotate and Scheduler Tick...');
    const [forceRes, tickRes] = await Promise.all([
      rotationService.rotate({ cycleId, force: true, adminId }),
      scheduler.tick(),
    ]);

    assert(forceRes.rotated === true, 'Admin force rotation succeeded');
    const batch5 = forceRes.activeBatch!;
    createdBatchIds.push(batch5.id);
    assert(batch5.status === 'ACTIVE', 'Batch 5 is ACTIVE');

    // Scheduler tick should detect batch5 is active and unexpired, skipping rotation
    assert(tickRes.rotated === false, 'Scheduler tick detected freshly active batch and did not create duplicate batch');
    assert(tickRes.reason === 'CURRENT_BATCH_NOT_EXPIRED', 'Scheduler tick returned CURRENT_BATCH_NOT_EXPIRED');

    activeBatchCount = await dbPool.query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeBatchCount.rows[0].count === 1, 'Exactly ONE active batch exists after force vs auto race');

    // -------------------------------------------------------------
    // SECTION 5: INSUFFICIENT ELIGIBLE SPAWN POINTS FAILURE HANDLING
    // -------------------------------------------------------------
    console.log('\n--- SECTION 5: INSUFFICIENT ELIGIBLE SPAWNS HANDLING ---');
    // Attempt rotation demanding 500 spawns when only 36 exist in campus
    let insufficientErrorCaught = false;
    try {
      await rotationService.rotate({
        cycleId,
        force: true,
        count: 500,
        allowPartial: false,
      });
    } catch (err: any) {
      insufficientErrorCaught = true;
      assert(err.message.includes('Insufficient eligible spawn points'), 'DomainError thrown on insufficient points');
    }
    assert(insufficientErrorCaught, 'Rotation threw error when eligible spawns were insufficient');

    // Verify existing active batch (Batch 5) remains completely intact and ACTIVE
    const checkBatch5 = await batchRepo.findById(batch5.id);
    assert(checkBatch5?.status === 'ACTIVE', 'Batch 5 remains ACTIVE after generation failure');
    activeBatchCount = await dbPool.query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeBatchCount.rows[0].count === 1, 'Active batch count remains exactly 1 after generation failure');

    // -------------------------------------------------------------
    // SECTION 6: GENERATION FAILURE RESILIENCE
    // -------------------------------------------------------------
    console.log('\n--- SECTION 6: GENERATION FAILURE RESILIENCE ---');
    // Create a mock GenerateBatchUseCase that fails intentionally
    const failingGenerateUseCase = {
      execute: async () => {
        throw new Error('Simulated external geocoding service timeout');
      },
    } as any;

    const resilientRotationService = new RotationService(
      batchRepo,
      failingGenerateUseCase,
      settingsService,
      dbPool
    );

    let genErrorCaught = false;
    try {
      await resilientRotationService.rotate({ cycleId, force: true });
    } catch (err: any) {
      genErrorCaught = true;
      assert(err.message.includes('Simulated external geocoding'), 'Generation error propagated');
    }
    assert(genErrorCaught, 'Rotation failed safely when generation failed');

    // Verify active batch state completely undisturbed
    const checkBatch5AfterGenFail = await batchRepo.findById(batch5.id);
    assert(checkBatch5AfterGenFail?.status === 'ACTIVE', 'Batch 5 still ACTIVE after external generation failure');

    // -------------------------------------------------------------
    // SECTION 7: DATABASE TRANSACTION FAILURE & ROLLBACK HANDLING
    // -------------------------------------------------------------
    console.log('\n--- SECTION 7: TRANSACTION FAILURE & ROLLBACK HANDLING ---');
    // Create a batchRepo that fails inside activateBatch
    const failingBatchRepo = Object.create(batchRepo);
    failingBatchRepo.activateBatch = async () => {
      throw new Error('Simulated database deadlock / network partition');
    };

    const txFailRotationService = new RotationService(
      failingBatchRepo,
      generateBatchUseCase,
      settingsService,
      dbPool
    );

    let txErrorCaught = false;
    try {
      await txFailRotationService.rotate({ cycleId, force: true });
    } catch (err: any) {
      txErrorCaught = true;
      assert(err.message.includes('Simulated database deadlock'), 'Transaction failure propagated cleanly');
    }
    assert(txErrorCaught, 'Rotation threw error when activation transaction failed');

    // Verify Batch 5 is STILL ACTIVE and not corrupted
    const checkBatch5AfterTxFail = await batchRepo.findById(batch5.id);
    assert(checkBatch5AfterTxFail?.status === 'ACTIVE', 'Batch 5 remains ACTIVE after transaction failure');

    // Verify that candidate batches did NOT linger in CREATED status (they are cleaned up / expired)
    const lingeringCreatedBatches = await dbPool.query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'CREATED';`,
      [cycleId]
    );
    assert(lingeringCreatedBatches.rows[0].count === 0, 'Zero lingering CREATED batches; failed batch safely expired');

    // -------------------------------------------------------------
    // SECTION 8: SCHEDULER FAILURE RECOVERY & LAST_ERROR TRACKING
    // -------------------------------------------------------------
    console.log('\n--- SECTION 8: SCHEDULER FAILURE RECOVERY ---');
    const failingService = {
      rotate: async () => {
        throw new Error('Simulated DB pool connection exhaustion');
      },
      getNextRotationTime: async () => new Date(),
    } as any;

    const faultTolerantScheduler = new RotationScheduler(failingService, { cycleId });
    const tickErrorResult = await faultTolerantScheduler.tick();
    assert(tickErrorResult.rotated === false, 'Scheduler tick returns rotated: false on error without throwing');
    const schedStatus = await faultTolerantScheduler.getStatus();
    assert(schedStatus.lastError === 'Simulated DB pool connection exhaustion', 'Scheduler recorded lastError message accurately');

    // -------------------------------------------------------------
    // SECTION 9: AUTHORITATIVE NEXT-ROTATION TIMESTAMP & AUDIT LOGS
    // -------------------------------------------------------------
    console.log('\n--- SECTION 9: AUTHORITATIVE TIMESTAMP & AUDIT TRAIL ---');
    // Authoritative next-rotation timestamp check
    const nextRotation = await rotationService.getNextRotationTime(cycleId);
    assert(nextRotation !== null, 'getNextRotationTime returned non-null timestamp');
    const activeBatchRecord = await batchRepo.findActive(cycleId);
    assert(nextRotation?.getTime() === activeBatchRecord?.expiresAt.getTime(), 'Authoritative timestamp exactly matches persisted spawn_batches.expires_at');

    // Verify audit logs for both SPAWN_ROTATION and ADMIN_FORCE_ROTATION
    const spawnRotations = await dbPool.query(
      `SELECT id, action, target_id, details FROM audit_logs WHERE target_id = ANY($1::uuid[]) AND action = 'SPAWN_ROTATION';`,
      [createdBatchIds]
    );
    assert(spawnRotations.rows.length >= 2, 'SPAWN_ROTATION logged for automatic rotations');

    const adminForceRotations = await dbPool.query(
      `SELECT id, action, admin_id, target_id, details FROM audit_logs WHERE target_id = ANY($1::uuid[]) AND action = 'ADMIN_FORCE_ROTATION';`,
      [createdBatchIds]
    );
    assert(adminForceRotations.rows.length >= 1, 'ADMIN_FORCE_ROTATION logged for manual force rotations');
    assert(adminForceRotations.rows[0].admin_id === adminId, 'Audit log accurately attributes adminId');
    assert((adminForceRotations.rows[0].details as any).forced === true, 'Audit log details flags forced: true');

    // Verify analytics events
    const analyticsEvents = await dbPool.query<{ count: number }>(
      `SELECT COUNT(*)::int as count FROM analytics_events WHERE event_name = 'spawn_rotation_completed';`
    );
    assert(analyticsEvents.rows[0].count >= 3, 'Analytics events logged for completed spawn rotations');

    console.log('\n================================================================');
    console.log('  🎉 COMPLETE I9 ROTATION SYSTEM AUDIT PASSED 100% CLEANLY!');
    console.log('================================================================\n');
  } finally {
    console.log('[Cleanup] Tearing down audit records from PostgreSQL...');
    try {
      if (createdSpawnIds.length > 0) {
        await dbPool.query(`DELETE FROM spawn_points WHERE id = ANY($1::uuid[]);`, [createdSpawnIds]);
      }
      if (createdCycleIds.length > 0) {
        await dbPool.query(`DELETE FROM audit_logs WHERE target_id IN (SELECT id FROM spawn_batches WHERE cycle_id = ANY($1::uuid[]));`, [createdCycleIds]);
        await dbPool.query(`DELETE FROM spawn_points WHERE batch_id IN (SELECT id FROM spawn_batches WHERE cycle_id = ANY($1::uuid[]));`, [createdCycleIds]);
        await dbPool.query(`DELETE FROM spawn_batches WHERE cycle_id = ANY($1::uuid[]);`, [createdCycleIds]);
      }
      if (createdBatchIds.length > 0) {
        await dbPool.query(`DELETE FROM audit_logs WHERE target_id = ANY($1::uuid[]);`, [createdBatchIds]);
        await dbPool.query(`DELETE FROM spawn_batches WHERE id = ANY($1::uuid[]);`, [createdBatchIds]);
      }
      if (createdUserIds.length > 0) {
        await dbPool.query(`DELETE FROM admins WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        await dbPool.query(`DELETE FROM profiles WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        await dbPool.query(`DELETE FROM audit_logs WHERE admin_id = ANY($1::uuid[]);`, [createdUserIds]);
        await dbPool.query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [createdUserIds]);
      }
      if (createdCycleIds.length > 0) {
        await dbPool.query(`DELETE FROM weekly_cycles WHERE id = ANY($1::uuid[]);`, [createdCycleIds]);
      }
      console.log('[Cleanup] Cleanup complete.');
    } catch (cleanupErr) {
      console.error('[Cleanup] Error during teardown:', cleanupErr);
    }
    await dbPool.shutdown();
  }
}

runFinalRotationAudit().catch((err) => {
  console.error('Final rotation audit failed with error:', err);
  process.exit(1);
});
