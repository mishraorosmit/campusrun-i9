/**
 * Project I9 — Complete Spawn-Batch Engine Audit (Phases 01 - 04)
 * 
 * Verifies:
 * 1. Lifecycle transitions (CREATED, ACTIVE, EXPIRED; legal vs illegal)
 * 2. Active-batch uniqueness (only one active batch at a time per cycle)
 * 3. Configured spawn count (selects 15 points or configured count)
 * 4. Minimum distance enforcement (>= 60m separation between all selected points)
 * 5. Disabled spawn exclusion (never selected for batches)
 * 6. Out-of-campus exclusion (never selected for batches)
 * 7. Correct timestamps (started_at, expires_at, expires_at > started_at)
 * 8. Expiration behavior (ACTIVE -> EXPIRED updates batch and spawns)
 * 9. Transaction atomicity (rollback on failure leaves previous active state intact)
 * 10. Concurrency safety (simultaneous activation attempts cleanly serialized)
 * 11. Idempotency (repeated activation / expiration is harmless)
 * 12. Insufficient eligible spawn points rejection
 */

import crypto from 'crypto';
import { dbPool } from './server/infrastructure/database/pool';
import { transactionManager } from './server/infrastructure/database/transaction';
import { PostgresBatchRepository } from './server/infrastructure/repositories/postgres/PostgresBatchRepository';
import { PostgresSpawnRepository } from './server/infrastructure/repositories/postgres/PostgresSpawnRepository';
import { PostgresGeospatialService } from './server/infrastructure/geo/PostgresGeospatialService';
import { GenerateBatchUseCase } from './server/services/GenerateBatchUseCase';
import { ActivateBatchUseCase } from './server/services/ActivateBatchUseCase';
import { ExpireBatchUseCase } from './server/services/ExpireBatchUseCase';
import { GetBatchByIdUseCase } from './server/services/GetBatchByIdUseCase';
import { GameSettingsService } from './server/services/GameSettingsService';
import { SpawnBatch } from './server/domain/entities/SpawnBatch';
import { SpawnPoint } from './server/domain/entities/SpawnPoint';
import { GeoService } from './server/infrastructure/geo/GeoService';
import { DomainError } from './server/errors/DomainError';
import { config } from './server/config';
import { Coordinates } from './server/domain/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion FAILED: ${message}`);
    throw new Error(`Assertion FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runBatchAuditSuite() {
  console.log('================================================================');
  console.log('  PROJECT I9 — COMPLETE SPAWN-BATCH ENGINE AUDIT (PHASES 01 - 04)');
  console.log('================================================================\n');

  // Initialize DB pool
  dbPool.initialize({
    connectionString: config.DATABASE_URL,
    max: 15,
    min: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statementTimeoutMillis: 10000,
  });

  const createdSpawnIds: string[] = [];
  const createdCycleIds: string[] = [];
  const createdBatchIds: string[] = [];

  const batchRepo = new PostgresBatchRepository(dbPool);
  const spawnRepo = new PostgresSpawnRepository(dbPool);
  const geoService = new PostgresGeospatialService(dbPool);
  const settingsService = new GameSettingsService(dbPool);

  const generateBatchUseCase = new GenerateBatchUseCase(
    batchRepo,
    spawnRepo,
    geoService,
    settingsService,
    dbPool
  );
  const activateBatchUseCase = new ActivateBatchUseCase(batchRepo);
  const expireBatchUseCase = new ExpireBatchUseCase(batchRepo);
  const getBatchByIdUseCase = new GetBatchByIdUseCase(batchRepo);

  try {
    // -------------------------------------------------------------
    // SECTION 0: Setup Authoritative Test Cycle
    // -------------------------------------------------------------
    console.log('--- SECTION 0: SETUP TEST CYCLE ---');
    const cycleId = crypto.randomUUID();
    createdCycleIds.push(cycleId);
    const cycleNumber = Math.floor(Date.now() / 1000);

    await dbPool.query(`
      INSERT INTO weekly_cycles (id, cycle_number, starts_at, ends_at, status)
      VALUES ($1, $2, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '6 days', 'active');
    `, [cycleId, cycleNumber]);

    assert(true, `Created active weekly cycle: ${cycleId} (cycle #${cycleNumber})`);

    // -------------------------------------------------------------
    // SECTION 1: LIFECYCLE STATES & LEGAL/ILLEGAL TRANSITIONS (PHASE 01)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 1: LIFECYCLE STATES & LEGAL TRANSITIONS ---');

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + 45 * 60 * 1000);
    const testBatchNumber1 = await batchRepo.getNextBatchNumber();

    const batch1 = SpawnBatch.create({
      batchNumber: testBatchNumber1,
      cycleId,
      startedAt,
      expiresAt,
      status: 'CREATED',
      spawnIds: [],
    });

    // Verify domain properties & initial state
    assert(batch1.status === 'CREATED', 'Initial state is CREATED');
    assert(batch1.isCreated() === true, 'isCreated() returns true');
    assert(batch1.isActive() === false, 'isActive() returns false on CREATED batch');
    assert(batch1.isExpired() === false, 'isExpired() returns false on CREATED batch');
    assert(batch1.expiresAt > batch1.startedAt, 'expiresAt is strictly after startedAt');

    // Persist in repository
    const createdBatch1 = await batchRepo.create(batch1);
    createdBatchIds.push(createdBatch1.id);
    assert(createdBatch1.id === batch1.id, 'batchRepo.create persists unique ID');
    assert(createdBatch1.status === 'CREATED', 'Persisted status in DB is CREATED');

    // 1.1 Legal Transition: CREATED -> ACTIVE
    const activatedBatch1 = await activateBatchUseCase.execute(createdBatch1.id);
    assert(activatedBatch1.status === 'ACTIVE', 'Legal transition CREATED -> ACTIVE succeeds');
    assert(activatedBatch1.isActive() === true, 'isActive() returns true on activated batch');
    assert(activatedBatch1.isCreated() === false, 'isCreated() returns false on activated batch');

    // Verify DB state
    const dbBatch1 = await batchRepo.findById(createdBatch1.id);
    assert(dbBatch1?.status === 'ACTIVE', 'Database reflects status ACTIVE');

    // 1.2 Legal Transition: ACTIVE -> EXPIRED
    const expiredBatch1 = await expireBatchUseCase.execute(createdBatch1.id);
    assert(expiredBatch1.status === 'EXPIRED', 'Legal transition ACTIVE -> EXPIRED succeeds');
    assert(expiredBatch1.isExpired() === true, 'isExpired() returns true on expired batch');
    assert(expiredBatch1.isActive() === false, 'isActive() returns false on expired batch');

    // 1.3 Legal Transition: CREATED -> EXPIRED (Cancellation before activation)
    const testBatchNumber2 = await batchRepo.getNextBatchNumber();
    const batch2 = SpawnBatch.create({
      batchNumber: testBatchNumber2,
      cycleId,
      startedAt,
      expiresAt,
      status: 'CREATED',
      spawnIds: [],
    });
    const createdBatch2 = await batchRepo.create(batch2);
    createdBatchIds.push(createdBatch2.id);

    const cancelledBatch2 = await expireBatchUseCase.execute(createdBatch2.id);
    assert(cancelledBatch2.status === 'EXPIRED', 'Legal transition CREATED -> EXPIRED (cancellation) succeeds');

    // 1.4 Illegal Transitions
    // EXPIRED -> ACTIVE
    let illegalCaught = false;
    try {
      await activateBatchUseCase.execute(createdBatch2.id);
    } catch (err: any) {
      illegalCaught = true;
      assert(err instanceof DomainError, 'Transition EXPIRED -> ACTIVE throws DomainError');
      assert(err.message.includes('Cannot activate an expired spawn batch'), 'Error message rejects expired activation');
    }
    assert(illegalCaught, 'Illegal transition EXPIRED -> ACTIVE was rejected');

    // Domain model direct check: EXPIRED -> CREATED
    illegalCaught = false;
    try {
      cancelledBatch2.transitionTo('CREATED');
    } catch (err: any) {
      illegalCaught = true;
      assert(err instanceof DomainError, 'Domain transition EXPIRED -> CREATED throws DomainError');
    }
    assert(illegalCaught, 'Illegal transition EXPIRED -> CREATED was rejected');

    // Domain model direct check: ACTIVE -> CREATED
    illegalCaught = false;
    try {
      activatedBatch1.transitionTo('CREATED');
    } catch (err: any) {
      illegalCaught = true;
      assert(err instanceof DomainError, 'Domain transition ACTIVE -> CREATED throws DomainError');
    }
    assert(illegalCaught, 'Illegal transition ACTIVE -> CREATED was rejected');

    // -------------------------------------------------------------
    // SECTION 2: IDEMPOTENCY
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: IDEMPOTENCY VERIFICATION ---');

    // Create a new batch and activate it
    const testBatchNumber3 = await batchRepo.getNextBatchNumber();
    const batch3 = SpawnBatch.create({
      batchNumber: testBatchNumber3,
      cycleId,
      startedAt,
      expiresAt,
      status: 'CREATED',
      spawnIds: [],
    });
    const createdBatch3 = await batchRepo.create(batch3);
    createdBatchIds.push(createdBatch3.id);

    const firstActivate = await activateBatchUseCase.execute(createdBatch3.id);
    assert(firstActivate.status === 'ACTIVE', 'First activation succeeds');

    // Repeated activation of the same batch must be harmless
    const secondActivate = await activateBatchUseCase.execute(createdBatch3.id);
    assert(secondActivate.status === 'ACTIVE', 'Second activation returns ACTIVE harmlessly');
    assert(secondActivate.id === firstActivate.id, 'Returns the same batch object');

    // Repeated expiration of the same batch must be harmless
    const firstExpire = await expireBatchUseCase.execute(createdBatch3.id);
    assert(firstExpire.status === 'EXPIRED', 'First expire succeeds');

    const secondExpire = await expireBatchUseCase.execute(createdBatch3.id);
    assert(secondExpire.status === 'EXPIRED', 'Second expire returns EXPIRED harmlessly');

    // -------------------------------------------------------------
    // SECTION 3: BATCH GENERATION & SPATIAL RULES (PHASE 02)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: BATCH GENERATION, SEPARATION & EXCLUSIONS ---');

    // Seed a grid of test spawn points across campus:
    // Campus bounds: Lat 37.4215 to 37.4330, Lng -122.1765 to -122.1615
    // 1. Valid enabled points separated by > 70m (6x6 grid = 36 points)
    const lats = [37.4320, 37.4305, 37.4290, 37.4275, 37.4260, 37.4245];
    const lngs = [-122.1750, -122.1735, -122.1720, -122.1705, -122.1690, -122.1675];
    const seedPoints: Coordinates[] = [];
    for (const lat of lats) {
      for (const lng of lngs) {
        seedPoints.push({ lat, lng });
      }
    }

    for (let i = 0; i < seedPoints.length; i++) {
      const coord = seedPoints[i];
      const svg = geoService.gpsToSvg(coord);
      const spawnId = crypto.randomUUID();
      createdSpawnIds.push(spawnId);

      const spawn = SpawnPoint.create({
        id: spawnId,
        code: `SPW-GEN-OK-${i + 1}-${Date.now()}`.substring(0, 30),
        title: `Campus Grid Node ${i + 1}`,
        coordinates: coord,
        svgCoordinates: svg,
        points: 100,
        enabled: true,
      });

      await spawnRepo.create(spawn);
    }

    // 2. Disabled spawn (Must NOT be selected)
    const disabledCoord: Coordinates = { lat: 37.4260, lng: -122.1750 };
    const disabledId = crypto.randomUUID();
    createdSpawnIds.push(disabledId);
    const disabledSpawn = SpawnPoint.create({
      id: disabledId,
      code: `SPW-DISABLED-${Date.now()}`.substring(0, 30),
      title: 'Disabled Node',
      coordinates: disabledCoord,
      svgCoordinates: geoService.gpsToSvg(disabledCoord),
      points: 100,
      enabled: false, // DISABLED
    });
    await spawnRepo.create(disabledSpawn);

    // 3. Out-of-campus spawn (Must NOT be selected)
    // Directly insert in DB bypassing domain validation
    const outOfCampusId = crypto.randomUUID();
    createdSpawnIds.push(outOfCampusId);
    await dbPool.query(`
      INSERT INTO spawn_points (
        id, code, title, location, svg_x, svg_y, status, enabled, points, claim_radius_meters
      ) VALUES (
        $1, $2, 'Out of Campus Node', point(-122.4194, 37.7749), 100, 100, 'active', true, 100, 25.0
      );
    `, [outOfCampusId, `SPW-OOB-${Date.now()}`.substring(0, 30)]);

    // 4. Point placed too close to Point 01 (< 60m separation, e.g. 15m away)
    const tooCloseCoord: Coordinates = { lat: 37.4320, lng: -122.1748 }; // ~17m from Point 01
    const tooCloseId = crypto.randomUUID();
    createdSpawnIds.push(tooCloseId);
    const tooCloseSpawn = SpawnPoint.create({
      id: tooCloseId,
      code: `SPW-TOOCLOSE-${Date.now()}`.substring(0, 30),
      title: 'Too Close Node',
      coordinates: tooCloseCoord,
      svgCoordinates: geoService.gpsToSvg(tooCloseCoord),
      points: 100,
      enabled: true,
    });
    await spawnRepo.create(tooCloseSpawn);

    // Execute Batch Generation with default settings: 15 points, 60m min distance
    const generatedBatch = await generateBatchUseCase.execute({
      cycleId,
      count: 15,
      minSeparationMeters: 60.0,
      durationMinutes: 45,
    });
    createdBatchIds.push(generatedBatch.id);

    assert(generatedBatch instanceof SpawnBatch, 'GenerateBatchUseCase returns a validated SpawnBatch entity');
    assert(generatedBatch.status === 'CREATED', 'Generated batch is created in CREATED state (unpublished)');
    assert(generatedBatch.spawnIds.length === 15, `Batch contains exactly configured count of 15 points (got ${generatedBatch.spawnIds.length})`);

    // Verify timestamp duration is approximately 45 minutes
    const durationMs = generatedBatch.expiresAt.getTime() - generatedBatch.startedAt.getTime();
    const durationMins = Math.round(durationMs / 60000);
    assert(durationMins === 45, `Expiration timestamp matches 45 min rotation interval (got ${durationMins}m)`);

    // Verify disabled spawn exclusion
    assert(!generatedBatch.spawnIds.includes(disabledId), 'Disabled spawn was strictly excluded from generated batch');

    // Verify out-of-campus exclusion
    assert(!generatedBatch.spawnIds.includes(outOfCampusId), 'Out-of-campus spawn was strictly excluded from generated batch');

    // Verify minimum separation across ALL 15 selected points in the batch
    const selectedSpawns: SpawnPoint[] = [];
    for (const sId of generatedBatch.spawnIds) {
      const s = await spawnRepo.findById(sId);
      assert(s !== null, `Selected spawn ${sId} exists in database`);
      selectedSpawns.push(s!);
    }

    let minMeasuredDistance = Infinity;
    for (let i = 0; i < selectedSpawns.length; i++) {
      for (let j = i + 1; j < selectedSpawns.length; j++) {
        const dist = GeoService.distanceBetweenPoints(
          selectedSpawns[i].coordinates,
          selectedSpawns[j].coordinates
        );
        if (dist < minMeasuredDistance) minMeasuredDistance = dist;
        assert(
          dist >= 60.0,
          `Pairwise separation between "${selectedSpawns[i].code}" and "${selectedSpawns[j].code}" is >= 60m (measured: ${dist}m)`
        );
      }
    }
    console.log(`  ✓ Minimum measured distance among all 15 selected spawns was ${minMeasuredDistance.toFixed(1)}m (>= 60m threshold)`);

    // Expire the test batch generated in Section 3 so that points are available for Section 5
    await expireBatchUseCase.execute(generatedBatch.id);

    // -------------------------------------------------------------
    // SECTION 4: INSUFFICIENT ELIGIBLE SPAWNS & GENERATION FAILURE
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: INSUFFICIENT ELIGIBLE SPAWN POINTS TEST ---');

    let insufficientCaught = false;
    try {
      // Request 100 points when only ~36 eligible points exist across campus
      await generateBatchUseCase.execute({
        cycleId,
        count: 100,
        minSeparationMeters: 60.0,
        allowPartial: false,
      });
    } catch (err: any) {
      insufficientCaught = true;
      assert(err instanceof DomainError, 'Insufficient eligible points throws DomainError');
      assert(err.message.includes('Insufficient eligible spawn points'), 'Error explicitly describes insufficient points');
    }
    assert(insufficientCaught, 'Generation fails when insufficient eligible points exist to satisfy configured count');

    // -------------------------------------------------------------
    // SECTION 5: ATOMIC BATCH ACTIVATION & ACTIVE-BATCH UNIQUENESS (PHASE 03)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 5: ATOMIC BATCH ACTIVATION & ACTIVE UNIQUENESS ---');

    // Batch A
    const batchA = await generateBatchUseCase.execute({ cycleId, count: 5, minSeparationMeters: 60.0 });
    createdBatchIds.push(batchA.id);

    // Batch B
    const batchB = await generateBatchUseCase.execute({ cycleId, count: 5, minSeparationMeters: 60.0 });
    createdBatchIds.push(batchB.id);

    // 5.1 Activate Batch A
    const activeBatchA = await activateBatchUseCase.execute(batchA.id);
    assert(activeBatchA.status === 'ACTIVE', 'Batch A activated successfully');

    // Verify member spawns of Batch A became active in DB
    const spawnsA = await dbPool.query(`SELECT status, enabled FROM spawn_points WHERE batch_id = $1;`, [batchA.id]);
    assert(spawnsA.rows.length === 5, 'Batch A has 5 member spawns');
    assert(spawnsA.rows.every((r) => r.status === 'active' && r.enabled === true), 'All member spawns of Batch A are active and enabled');

    // Verify exactly ONE active batch exists in this cycle
    let activeBatchCount = await dbPool.query(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeBatchCount.rows[0].count === 1, 'Exactly ONE active batch exists in cycle after Batch A activation');

    // 5.2 Activate Batch B: Atomic Handoff
    const activeBatchB = await activateBatchUseCase.execute(batchB.id);
    assert(activeBatchB.status === 'ACTIVE', 'Batch B activated successfully');

    // Verify Batch A atomically transitioned to EXPIRED
    const checkBatchA = await batchRepo.findById(batchA.id);
    assert(checkBatchA?.status === 'EXPIRED', 'Previous Batch A atomically transitioned to EXPIRED');

    // Verify member spawns of Batch A transitioned to expired
    const checkSpawnsA = await dbPool.query(`SELECT status FROM spawn_points WHERE batch_id = $1;`, [batchA.id]);
    assert(checkSpawnsA.rows.every((r) => r.status === 'expired'), 'Member spawns of previous Batch A transitioned to expired');

    // Verify member spawns of Batch B became active
    const checkSpawnsB = await dbPool.query(`SELECT status, enabled FROM spawn_points WHERE batch_id = $1;`, [batchB.id]);
    assert(checkSpawnsB.rows.every((r) => r.status === 'active' && r.enabled === true), 'Member spawns of new Batch B became active and enabled');

    // Verify exactly ONE active batch exists in this cycle
    activeBatchCount = await dbPool.query(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeBatchCount.rows[0].count === 1, 'Exactly ONE active batch exists in cycle after Batch B activation');

    // -------------------------------------------------------------
    // SECTION 6: TRANSACTION ATOMICITY & ROLLBACK SAFETY
    // -------------------------------------------------------------
    console.log('\n--- SECTION 6: TRANSACTION ATOMICITY & ROLLBACK SAFETY ---');

    // Generate Batch C
    const batchC = await generateBatchUseCase.execute({ cycleId, count: 5, minSeparationMeters: 60.0 });
    createdBatchIds.push(batchC.id);

    // Simulate failure during activation transaction
    let simulatedFailed = false;
    try {
      await transactionManager.runInTransaction(async (tx) => {
        // Expire current active batch
        await batchRepo.expireBatch(batchB.id, tx);
        // Throw intentional error before completing activation
        throw new Error('Simulated atomic activation failure');
      });
    } catch (err: any) {
      simulatedFailed = true;
      assert(err.message.includes('Simulated atomic activation failure'), 'Simulated transaction error caught');
    }
    assert(simulatedFailed, 'Activation transaction failed as simulated');

    // Verify rollback: Batch B must STILL be ACTIVE and its spawns STILL active!
    const verifyRollbackBatchB = await batchRepo.findById(batchB.id);
    assert(verifyRollbackBatchB?.status === 'ACTIVE', 'Batch B is still ACTIVE after transaction rollback');

    const verifyRollbackSpawnsB = await dbPool.query(`SELECT status FROM spawn_points WHERE batch_id = $1;`, [batchB.id]);
    assert(verifyRollbackSpawnsB.rows.every((r) => r.status === 'active'), 'Member spawns of Batch B remain active after rollback');

    // -------------------------------------------------------------
    // SECTION 7: CONCURRENCY SAFETY (SIMULTANEOUS ACTIVATION ATTEMPTS)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 7: CONCURRENCY SAFETY & SIMULTANEOUS ACTIVATIONS ---');

    // Generate 5 distinct batches
    const concurrentBatches: SpawnBatch[] = [];
    for (let i = 0; i < 5; i++) {
      const b = await generateBatchUseCase.execute({ cycleId, count: 3, minSeparationMeters: 60.0 });
      createdBatchIds.push(b.id);
      concurrentBatches.push(b);
    }

    // Launch all 5 activations simultaneously using Promise.all
    console.log(`[Concurrency] Launching 5 simultaneous activation attempts on cycle ${cycleId}...`);
    const results = await Promise.allSettled(
      concurrentBatches.map((b) => activateBatchUseCase.execute(b.id))
    );

    // All should succeed or be cleanly serialized without deadlocks
    const successfulActivations = results.filter((r) => r.status === 'fulfilled');
    console.log(`[Concurrency] Completed ${successfulActivations.length} / 5 concurrent activation requests.`);

    // Verify that at the conclusion, EXACTLY ONE active batch exists in the cycle
    const finalActiveRes = await dbPool.query(
      `SELECT id, batch_number FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(finalActiveRes.rows.length === 1, `PostgreSQL database has EXACTLY ONE active batch (found: ${finalActiveRes.rows.length})`);
    console.log(`  ✓ Concurrency lock serialized operations cleanly. Final active batch ID: ${finalActiveRes.rows[0].id} (batch #${finalActiveRes.rows[0].batch_number})`);

    // Verify that all other batches in the cycle are EXPIRED
    const otherBatches = await dbPool.query(
      `SELECT status, COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 GROUP BY status;`,
      [cycleId]
    );
    console.log('[Concurrency] Final cycle batch status breakdown:', otherBatches.rows);
    const activeRow = otherBatches.rows.find((r) => r.status === 'ACTIVE');
    assert(activeRow?.count === 1, 'Only 1 active batch in breakdown');

    console.log('\n================================================================');
    console.log('  🎉 ALL SPAWN-BATCH ENGINE AUDITS (PHASES 01 - 04) PASSED!');
    console.log('================================================================\n');
  } finally {
    console.log('[Cleanup] Cleaning up test records from PostgreSQL...');
    try {
      if (createdSpawnIds.length > 0) {
        await dbPool.query(`DELETE FROM claims WHERE spawn_id = ANY($1::uuid[]);`, [createdSpawnIds]);
        await dbPool.query(`DELETE FROM spawn_points WHERE id = ANY($1::uuid[]);`, [createdSpawnIds]);
      }
      if (createdBatchIds.length > 0) {
        await dbPool.query(`DELETE FROM claims WHERE batch_id = ANY($1::uuid[]);`, [createdBatchIds]);
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

runBatchAuditSuite().catch((err) => {
  console.error('Batch audit failed with error:', err);
  process.exit(1);
});
