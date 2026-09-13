import crypto from 'crypto';
import { config } from './server/config';
import { dbPool } from './server/infrastructure/database/pool';
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

async function runRotationAuditSuite() {
  console.log('================================================================');
  console.log('  PROJECT I9 — ROTATION SERVICE & SCHEDULER AUDIT (PHASES 01 - 02)');
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

  const batchRepo = new PostgresBatchRepository(dbPool);
  const spawnRepo = new PostgresSpawnRepository(dbPool);
  const geoService = new PostgresGeospatialService(dbPool);
  const settingsService = new GameSettingsService(dbPool);
  const generateBatchUseCase = new GenerateBatchUseCase(batchRepo, spawnRepo, geoService, settingsService, dbPool);
  const activateBatchUseCase = new ActivateBatchUseCase(batchRepo);
  const rotationService = new RotationService(batchRepo, generateBatchUseCase, settingsService, dbPool);

  const createdCycleIds: string[] = [];
  const createdSpawnIds: string[] = [];
  const createdBatchIds: string[] = [];

  try {
    // -------------------------------------------------------------
    // SECTION 0: SEED TEST ENVIRONMENT (CYCLE & 36 CAMPUS SPAWNS)
    // -------------------------------------------------------------
    console.log('--- SECTION 0: SEED TEST ENVIRONMENT ---');
    // Ensure no conflicting active cycles exist
    await dbPool.query(`UPDATE weekly_cycles SET status = 'completed' WHERE status = 'active';`);

    const cycleId = crypto.randomUUID();
    createdCycleIds.push(cycleId);
    await dbPool.query(
      `
      INSERT INTO weekly_cycles (id, cycle_number, starts_at, ends_at, status)
      VALUES ($1, $2, NOW() - INTERVAL '1 day', NOW() + INTERVAL '6 days', 'active');
      `,
      [cycleId, Math.floor(Date.now() / 1000)]
    );
    assert(true, 'Test active weekly cycle created in PostgreSQL');

    // Seed a 6x6 grid of 36 valid spawn points inside campus bounds
    const lats = [37.4320, 37.4305, 37.4290, 37.4275, 37.4260, 37.4245];
    const lngs = [-122.1750, -122.1735, -122.1720, -122.1705, -122.1690, -122.1675];
    let pointCount = 0;
    for (let i = 0; i < lats.length; i++) {
      for (let j = 0; j < lngs.length; j++) {
        pointCount++;
        const coord: Coordinates = { lat: lats[i], lng: lngs[j] };
        const spawnId = crypto.randomUUID();
        createdSpawnIds.push(spawnId);
        const spawn = SpawnPoint.create({
          id: spawnId,
          code: `SPW-ROT-${pointCount}-${Date.now()}`.substring(0, 30),
          title: `Rotation Campus Node ${pointCount}`,
          coordinates: coord,
          svgCoordinates: geoService.gpsToSvg(coord),
          points: 100,
          enabled: true,
        });
        await spawnRepo.create(spawn);
      }
    }
    assert(createdSpawnIds.length === 36, 'Seeded 36 valid campus spawn points in PostgreSQL');

    // -------------------------------------------------------------
    // SECTION 1: ROTATION SERVICE — COLD START & INITIAL GENERATION
    // -------------------------------------------------------------
    console.log('\n--- SECTION 1: COLD START & INITIAL ROTATION ---');
    const coldStartResult = await rotationService.rotate({
      cycleId,
      intervalMinutes: 45,
      count: 5,
      minSeparationMeters: 60.0,
    });

    assert(coldStartResult.rotated === true, 'Cold-start rotation rotated successfully');
    assert(coldStartResult.reason === 'ROTATION_COMPLETED', 'Reason is ROTATION_COMPLETED');
    assert(coldStartResult.activeBatch !== null, 'Active batch returned');
    assert(coldStartResult.activeBatch!.status === 'ACTIVE', 'Active batch has status ACTIVE');
    assert(coldStartResult.previousBatchId === null, 'No previous batch existed');
    assert(coldStartResult.rotationEventId !== null, 'Rotation event logged');

    const firstBatchId = coldStartResult.activeBatch!.id;
    createdBatchIds.push(firstBatchId);

    // Verify member spawns of first batch became active
    const activeSpawns1 = await dbPool.query(
      `SELECT status, enabled FROM spawn_points WHERE batch_id = $1;`,
      [firstBatchId]
    );
    assert(activeSpawns1.rows.length === 5, '5 member spawns active for first batch');
    assert(activeSpawns1.rows.every((r) => r.status === 'active' && r.enabled === true), 'All member spawns active and enabled');

    // Verify exactly ONE active batch exists in cycle
    let activeBatchCount = await dbPool.query(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeBatchCount.rows[0].count === 1, 'Exactly ONE active batch exists in cycle');

    // -------------------------------------------------------------
    // SECTION 2: ROTATION SERVICE — IDEMPOTENT EXECUTION (NOT EXPIRED)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: IDEMPOTENCY & UNEXPIRED BATCH ---');
    // Immediate second rotation call without force flag
    const idempotentResult = await rotationService.rotate({ cycleId });
    assert(idempotentResult.rotated === false, 'Rotation skipped because current batch has not expired');
    assert(idempotentResult.reason === 'CURRENT_BATCH_NOT_EXPIRED', 'Reason is CURRENT_BATCH_NOT_EXPIRED');
    assert(idempotentResult.activeBatch?.id === firstBatchId, 'Active batch remains first batch');

    // Verify no new batch was created
    const totalBatches = await dbPool.query(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1;`,
      [cycleId]
    );
    assert(totalBatches.rows[0].count === 1, 'No duplicate batch created during idempotent check');

    // -------------------------------------------------------------
    // SECTION 3: ROTATION SERVICE — EXPIRATION DETECTION & ATOMIC HANDOFF
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: EXPIRATION DETECTION & ATOMIC ROTATION ---');
    // Simulate time advancing past firstBatch expiration (+1 second after expiresAt)
    const futureTime = new Date(coldStartResult.activeBatch!.expiresAt.getTime() + 1000);

    const expiredRotationResult = await rotationService.rotate({
      cycleId,
      now: futureTime,
      intervalMinutes: 45,
      count: 5,
      minSeparationMeters: 60.0,
    });

    assert(expiredRotationResult.rotated === true, 'Rotation executed when current batch expired');
    assert(expiredRotationResult.reason === 'ROTATION_COMPLETED', 'Reason is ROTATION_COMPLETED');
    assert(expiredRotationResult.previousBatchId === firstBatchId, 'Previous batch correctly identified');

    const secondBatchId = expiredRotationResult.activeBatch!.id;
    createdBatchIds.push(secondBatchId);
    assert(secondBatchId !== firstBatchId, 'New distinct batch generated and activated');

    // Verify first batch atomically transitioned to EXPIRED
    const checkFirstBatch = await batchRepo.findById(firstBatchId);
    assert(checkFirstBatch?.status === 'EXPIRED', 'Previous batch atomically transitioned to EXPIRED');

    // Verify member spawns of first batch transitioned to expired
    const checkFirstSpawns = await dbPool.query(
      `SELECT status FROM spawn_points WHERE batch_id = $1;`,
      [firstBatchId]
    );
    assert(checkFirstSpawns.rows.every((r) => r.status === 'expired'), 'Member spawns of previous batch transitioned to expired');

    // Verify member spawns of second batch became active
    const checkSecondSpawns = await dbPool.query(
      `SELECT status, enabled FROM spawn_points WHERE batch_id = $1;`,
      [secondBatchId]
    );
    assert(checkSecondSpawns.rows.length === 5, '5 member spawns active for new batch');
    assert(checkSecondSpawns.rows.every((r) => r.status === 'active' && r.enabled === true), 'Member spawns of new batch are active and enabled');

    // Verify active batch uniqueness
    activeBatchCount = await dbPool.query(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeBatchCount.rows[0].count === 1, 'Exactly ONE active batch exists in cycle after second rotation');

    // -------------------------------------------------------------
    // SECTION 4: ROTATION EVENT LOGGING (AUDIT & ANALYTICS)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: ROTATION EVENT RECORDING ---');
    const auditLogs = await dbPool.query(
      `SELECT action, target_id, details FROM audit_logs WHERE action = 'SPAWN_ROTATION' ORDER BY created_at DESC;`
    );
    assert(auditLogs.rows.length >= 2, 'At least 2 SPAWN_ROTATION entries logged to audit_logs');

    const latestAudit = auditLogs.rows[0];
    const details = (latestAudit.details || {}) as any;
    assert(latestAudit.target_id === secondBatchId, 'Latest audit log targets new active batch');
    assert(details.previousBatchId === firstBatchId, 'Audit log records previous batch ID');
    assert(details.newBatchId === secondBatchId, 'Audit log records new batch ID');
    assert(details.spawnCount === 5, 'Audit log records spawn count');

    const analyticsLogs = await dbPool.query(
      `SELECT event_name, properties FROM analytics_events WHERE event_name = 'spawn_rotation_completed' ORDER BY created_at DESC;`
    );
    assert(analyticsLogs.rows.length >= 2, 'Analytics events logged for spawn rotations');

    // -------------------------------------------------------------
    // SECTION 5: ROTATION SERVICE — CONCURRENCY SAFETY
    // -------------------------------------------------------------
    console.log('\n--- SECTION 5: CONCURRENCY SAFETY (SIMULTANEOUS ROTATIONS) ---');
    // Simulate current batch expiring again
    const futureTime2 = new Date(expiredRotationResult.activeBatch!.expiresAt.getTime() + 1000);

    // Launch 5 simultaneous rotation requests
    console.log('[Concurrency] Launching 5 simultaneous rotation requests...');
    const concurrentResults = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        rotationService.rotate({
          cycleId,
          now: futureTime2,
          count: 5,
          minSeparationMeters: 60.0,
        })
      )
    );

    // Exactly 1 request should perform rotation, the other 4 should recognize the new batch
    const rotationsCompleted = concurrentResults.filter((r) => r.rotated === true);
    const unexpiredSkips = concurrentResults.filter(
      (r) => r.rotated === false && r.reason === 'CURRENT_BATCH_NOT_EXPIRED'
    );

    console.log(`[Concurrency] Results: ${rotationsCompleted.length} rotated, ${unexpiredSkips.length} detected updated batch.`);
    assert(rotationsCompleted.length === 1, 'Exactly ONE caller rotated and created a new batch');
    assert(unexpiredSkips.length === 4, 'All other 4 callers detected the updated batch without duplicate rotation');

    // Verify all callers received the exact same active batch
    const newActiveBatchId = rotationsCompleted[0].activeBatch!.id;
    createdBatchIds.push(newActiveBatchId);
    assert(
      concurrentResults.every((r) => r.activeBatch?.id === newActiveBatchId),
      'All 5 concurrent callers received the identical new active batch'
    );

    // Database check for active batch uniqueness
    activeBatchCount = await dbPool.query(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeBatchCount.rows[0].count === 1, 'Exactly ONE active batch exists in cycle after concurrent rotation storm');

    // -------------------------------------------------------------
    // SECTION 6: ROTATION SCHEDULER (PHASE 02) — AUTHORITATIVE NEXT TIME
    // -------------------------------------------------------------
    console.log('\n--- SECTION 6: ROTATION SCHEDULER — AUTHORITATIVE TIMESTAMP ---');
    const scheduler = new RotationScheduler(rotationService, {
      cycleId,
      retryBackoffMs: 1000,
    });

    // Authoritative next rotation timestamp matches active batch in DB
    const authoritativeNext = await scheduler.getNextRotationTime();
    const currentActiveBatch = await batchRepo.findActive(cycleId);
    assert(authoritativeNext !== null, 'Scheduler retrieves next rotation timestamp');
    assert(
      authoritativeNext?.getTime() === currentActiveBatch?.expiresAt.getTime(),
      'Authoritative next-rotation timestamp matches persisted spawn_batches.expires_at'
    );

    // -------------------------------------------------------------
    // SECTION 7: ROTATION SCHEDULER — RESTART BEHAVIOR & DELAYED EXECUTION
    // -------------------------------------------------------------
    console.log('\n--- SECTION 7: ROTATION SCHEDULER — RESTART & DELAY TOLERANCE ---');
    // Start the scheduler
    await scheduler.start();
    const status = await scheduler.getStatus();
    assert(status.isRunning === true, 'Scheduler isRunning is true after start()');
    assert(status.isRotating === false, 'Scheduler isRotating is false when idle');

    // Manually trigger tick when current batch has NOT expired
    const idleTick = await scheduler.tick();
    assert(idleTick.rotated === false, 'Scheduler tick does not rotate unexpired batch');

    // Simulate delayed execution: expire the active batch directly in PostgreSQL
    await dbPool.query(
      `UPDATE spawn_batches SET started_at = NOW() - INTERVAL '50 minutes', expires_at = NOW() - INTERVAL '5 minutes' WHERE id = $1;`,
      [newActiveBatchId]
    );

    // Scheduler tick executes delayed rotation immediately
    const delayedTick = await scheduler.tick();
    assert(delayedTick.rotated === true, 'Scheduler tolerates delayed execution and rotates expired batch immediately');
    createdBatchIds.push(delayedTick.activeBatch!.id);

    // -------------------------------------------------------------
    // SECTION 8: ROTATION SCHEDULER — OVERLAP PREVENTION
    // -------------------------------------------------------------
    console.log('\n--- SECTION 8: ROTATION SCHEDULER — OVERLAP PREVENTION ---');
    // Simulate tick running while isRotating flag is active
    (scheduler as any).isRotating = true;
    const overlappedTick = await scheduler.tick();
    assert(overlappedTick.rotated === false, 'Overlapping tick is safely prevented');
    assert(overlappedTick.reason === 'IDEMPOTENT_NO_OP', 'Overlapping tick returns IDEMPOTENT_NO_OP');
    (scheduler as any).isRotating = false;

    // -------------------------------------------------------------
    // SECTION 9: ROTATION SCHEDULER — RECOVERY FROM FAILED ATTEMPTS
    // -------------------------------------------------------------
    console.log('\n--- SECTION 9: ROTATION SCHEDULER — FAILURE RECOVERY ---');
    // Mock a failing rotation service
    const failingService = {
      rotate: async () => {
        throw new Error('Simulated transient DB connection timeout');
      },
      getNextRotationTime: async () => null,
    };

    const recoveringScheduler = new RotationScheduler(failingService as any, {
      cycleId,
      retryBackoffMs: 500,
    });

    const failedTick = await recoveringScheduler.tick();
    assert(failedTick.rotated === false, 'Failed tick returns rotated: false without throwing');
    const failingStatus = await recoveringScheduler.getStatus();
    assert(failingStatus.lastError !== null, 'Scheduler records lastError from failed rotation');
    assert(failingStatus.lastError?.includes('Simulated transient DB'), 'Error message recorded accurately');

    // Clean up schedulers
    scheduler.stop();
    recoveringScheduler.stop();
    assert(true, 'Schedulers stopped cleanly');

    console.log('\n================================================================');
    console.log('  🎉 ALL ROTATION PHASES 01 & 02 AUDITS PASSED CLEANLY!');
    console.log('================================================================\n');
  } finally {
    console.log('[Cleanup] Cleaning up test records from PostgreSQL...');
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

runRotationAuditSuite().catch((err) => {
  console.error('Rotation audit failed with error:', err);
  process.exit(1);
});
