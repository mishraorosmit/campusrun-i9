/**
 * Project I9 — Rotation Phase 03 Audit (Admin Manual "Force Rotate")
 * 
 * Verifies:
 * 1. Admin authorization (401 unauthenticated, 403 student, 200 admin)
 * 2. Invocation of unified RotationService (no duplicate logic)
 * 3. Safe expiration of current batch (transitions to EXPIRED and member spawns to expired)
 * 4. Generation and activation of new batch (transitions to ACTIVE and member spawns to active)
 * 5. Audit event recording in audit_logs (action: ADMIN_FORCE_ROTATION, admin_id, metadata)
 * 6. Authoritative new batch state payload returned
 * 7. Safe concurrent execution against automatic rotation scheduler
 */

import http from 'http';
import crypto from 'crypto';
import { JwtUtils } from './server/infrastructure/auth/JwtUtils';
import { createApp } from './server/app';
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

async function requestJson(url: string, options: { method?: string; headers?: Record<string, string>; body?: any } = {}) {
  const parsed = new URL(url);
  const bodyData = options.body ? JSON.stringify(options.body) : null;
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };
  if (bodyData) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(bodyData).toString();
  }

  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsedBody = null;
          try {
            parsedBody = raw ? JSON.parse(raw) : null;
          } catch {
            parsedBody = raw;
          }
          resolve({ status: res.statusCode || 500, body: parsedBody });
        });
      }
    );
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function runForceRotateAuditSuite() {
  console.log('================================================================');
  console.log('  PROJECT I9 — ROTATION PHASE 03 (ADMIN FORCE ROTATE AUDIT)');
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

  const createdCycleIds: string[] = [];
  const createdSpawnIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdBatchIds: string[] = [];

  const batchRepo = new PostgresBatchRepository(dbPool);
  const spawnRepo = new PostgresSpawnRepository(dbPool);
  const geoService = new PostgresGeospatialService(dbPool);
  const settingsService = new GameSettingsService(dbPool);
  const generateBatchUseCase = new GenerateBatchUseCase(batchRepo, spawnRepo, geoService, settingsService, dbPool);
  const activateBatchUseCase = new ActivateBatchUseCase(batchRepo);
  const rotationService = new RotationService(batchRepo, generateBatchUseCase, settingsService, dbPool);
  const rotationScheduler = new RotationScheduler(rotationService);

  let server: http.Server | null = null;
  let baseUrl = '';

  try {
    // -------------------------------------------------------------
    // SECTION 0: SEED TEST ACTORS, TOKENS, CYCLE & SPAWN POINTS
    // -------------------------------------------------------------
    console.log('--- SECTION 0: SETUP ENVIRONMENT & ACTORS ---');
    // Ensure no conflicting active cycles
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
    assert(true, 'Created active weekly cycle');

    // Seed 36 valid spawn points across campus
    const lats = [37.4320, 37.4305, 37.4290, 37.4275, 37.4260, 37.4245];
    const lngs = [-122.1750, -122.1735, -122.1720, -122.1705, -122.1690, -122.1675];
    let pt = 0;
    for (let i = 0; i < lats.length; i++) {
      for (let j = 0; j < lngs.length; j++) {
        pt++;
        const coord: Coordinates = { lat: lats[i], lng: lngs[j] };
        const spawnId = crypto.randomUUID();
        createdSpawnIds.push(spawnId);
        const spawn = SpawnPoint.create({
          id: spawnId,
          code: `SPW-FORCE-${pt}-${Date.now()}`.substring(0, 30),
          title: `Force Rotate Node ${pt}`,
          coordinates: coord,
          svgCoordinates: geoService.gpsToSvg(coord),
          points: 100,
          enabled: true,
        });
        await spawnRepo.create(spawn);
      }
    }
    assert(createdSpawnIds.length === 36, 'Seeded 36 valid campus spawn points');

    // Seed student user
    const studentId = crypto.randomUUID();
    const studentEmail = `student_${Date.now()}@stanford.edu`;
    createdUserIds.push(studentId);
    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [studentId, studentEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name) VALUES ($1, $2, $3);`,
      [studentId, `student_${Date.now()}`.substring(0, 20), 'Test Student']
    );

    // Seed admin user
    const adminId = crypto.randomUUID();
    const adminEmail = `admin_${Date.now()}@stanford.edu`;
    createdUserIds.push(adminId);
    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [adminId, adminEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name) VALUES ($1, $2, $3);`,
      [adminId, `admin_${Date.now()}`.substring(0, 20), 'Test Admin']
    );
    await dbPool.query(
      `INSERT INTO admins (user_id, role, granted_by) VALUES ($1, 'superadmin', $1);`,
      [adminId]
    );

    // Generate valid JWT tokens
    const studentToken = JwtUtils.sign(
      { sub: studentId, email: studentEmail, username: 'student', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );
    const adminToken = JwtUtils.sign(
      { sub: adminId, email: adminEmail, username: 'admin', role: 'ADMIN' },
      config.JWT_SECRET,
      3600
    );
    assert(true, 'Generated student and admin signed JWT tokens');

    // Start express app server
    const app = createApp({
      batchRepo,
      spawnRepo,
      geoService,
      rotationService,
      rotationScheduler,
    });
    server = http.createServer(app);
    await new Promise<void>((res) => server!.listen(0, res));
    const port = (server.address() as any).port;
    baseUrl = `http://localhost:${port}`;
    console.log(`[Test Server] Running at ${baseUrl}`);

    // Initial cold-start rotation to create Batch 1
    const initRotation = await rotationService.rotate({ cycleId, intervalMinutes: 45, count: 5, minSeparationMeters: 60.0 });
    const initialBatchId = initRotation.activeBatch!.id;
    createdBatchIds.push(initialBatchId);
    assert(initRotation.rotated === true, 'Initial batch generated and active');

    // -------------------------------------------------------------
    // SECTION 1: SERVER-SIDE AUTHORIZATION CHECKS
    // -------------------------------------------------------------
    console.log('\n--- SECTION 1: SERVER-SIDE AUTHORIZATION ---');

    // 1.1 Unauthenticated request
    const unauthRes = await requestJson(`${baseUrl}/api/v1/admin/rotate`, { method: 'POST' });
    assert(unauthRes.status === 401, 'Unauthenticated POST /api/v1/admin/rotate returns 401 Unauthorized');

    // 1.2 Student token request
    const studentRes = await requestJson(`${baseUrl}/api/v1/admin/rotate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(studentRes.status === 403, 'Student token to POST /api/v1/admin/rotate returns 403 Forbidden');

    // 1.3 Unauthenticated request to alias /rotation/force
    const unauthAlias = await requestJson(`${baseUrl}/api/v1/admin/rotation/force`, { method: 'POST' });
    assert(unauthAlias.status === 401, 'Unauthenticated POST /api/v1/admin/rotation/force returns 401 Unauthorized');

    // 1.4 Student token request to alias /rotation/force
    const studentAlias = await requestJson(`${baseUrl}/api/v1/admin/rotation/force`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(studentAlias.status === 403, 'Student token to POST /api/v1/admin/rotation/force returns 403 Forbidden');

    // -------------------------------------------------------------
    // SECTION 2: ADMIN FORCE ROTATE EXECUTION & BATCH HANDOFF
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: ADMIN FORCE ROTATION EXECUTION ---');

    // Verify initial batch is STILL unexpired
    const checkUnexpired = await batchRepo.findById(initialBatchId);
    assert(checkUnexpired?.status === 'ACTIVE', 'Initial batch is currently ACTIVE');
    assert(new Date() < checkUnexpired!.expiresAt, 'Initial batch has NOT expired (expires in ~45 min)');

    // Execute Admin Force Rotate via POST /api/v1/admin/rotate
    const forceRotateRes = await requestJson(`${baseUrl}/api/v1/admin/rotate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { force: true, count: 5 },
    });

    assert(forceRotateRes.status === 200, 'Admin token to POST /api/v1/admin/rotate returns 200 OK');
    assert(forceRotateRes.body.success === true, 'Response body success is true');
    assert(forceRotateRes.body.data.rotated === true, 'Response body confirms rotation executed');
    assert(forceRotateRes.body.data.batch !== null, 'Response body includes authoritative batch data');
    assert(forceRotateRes.body.data.batch.status === 'ACTIVE', 'New batch is ACTIVE');
    assert(forceRotateRes.body.data.previousBatchId === initialBatchId, 'Response records previousBatchId');

    const forcedBatchId = forceRotateRes.body.data.batch.id;
    createdBatchIds.push(forcedBatchId);
    assert(forcedBatchId !== initialBatchId, 'New batch ID is distinct from initial batch');

    // Verify initial batch was expired safely in PostgreSQL
    const checkInitialAfter = await batchRepo.findById(initialBatchId);
    assert(checkInitialAfter?.status === 'EXPIRED', 'Previous batch safely transitioned to EXPIRED');

    // Verify member spawns of initial batch are now expired
    const initialSpawns = await dbPool.query(
      `SELECT status FROM spawn_points WHERE batch_id = $1;`,
      [initialBatchId]
    );
    assert(initialSpawns.rows.every((r) => r.status === 'expired'), 'Member spawns of previous batch safely transitioned to expired');

    // Verify member spawns of new batch are active
    const newSpawns = await dbPool.query(
      `SELECT status, enabled FROM spawn_points WHERE batch_id = $1;`,
      [forcedBatchId]
    );
    assert(newSpawns.rows.length === 5, '5 member spawns active in new forced batch');
    assert(newSpawns.rows.every((r) => r.status === 'active' && r.enabled === true), 'Member spawns of new batch are active and enabled');

    // Verify exactly ONE active batch exists in cycle
    let activeCount = await dbPool.query(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeCount.rows[0].count === 1, 'Exactly ONE active batch exists in cycle after force rotate');

    // -------------------------------------------------------------
    // SECTION 3: AUDIT TRAIL VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: AUDIT TRAIL VERIFICATION ---');
    const forceAuditRes = await dbPool.query<{
      admin_id: string;
      action: string;
      target_id: string;
      details: any;
    }>(
      `SELECT admin_id, action, target_id, details FROM audit_logs WHERE action = 'ADMIN_FORCE_ROTATION' ORDER BY created_at DESC LIMIT 1;`
    );
    assert(forceAuditRes.rows.length === 1, 'ADMIN_FORCE_ROTATION logged to audit_logs');
    const auditRow = forceAuditRes.rows[0];
    assert(auditRow.admin_id === adminId, 'Audit log accurately records authenticated adminId');
    assert(auditRow.target_id === forcedBatchId, 'Audit log target_id matches new active batch ID');
    assert(auditRow.details?.forced === true, 'Audit log details flags forced: true');
    assert(auditRow.details?.previousBatchId === initialBatchId, 'Audit log details records previousBatchId');

    // -------------------------------------------------------------
    // SECTION 4: CONCURRENCY SAFETY (FORCE ROTATE VS AUTOMATIC SCHEDULER)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: CONCURRENCY SAFETY (FORCE ROTATE VS AUTOMATIC TICK) ---');
    // Launch an admin force rotate AND an automatic scheduler tick simultaneously
    console.log('[Concurrency] Triggering simultaneous Admin Force Rotate and Scheduler Tick...');
    const [adminCallResult, schedulerTickResult] = await Promise.all([
      requestJson(`${baseUrl}/api/v1/admin/rotation/force`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { force: true },
      }),
      rotationScheduler.tick(),
    ]);

    assert(adminCallResult.status === 200, 'Admin force rotate request succeeded (200 OK)');
    assert(adminCallResult.body.data.rotated === true, 'Admin force rotate successfully executed');
    const concurrentForcedBatchId = adminCallResult.body.data.batch.id;
    createdBatchIds.push(concurrentForcedBatchId);

    // Automatic scheduler tick should detect the new batch under lock and skip duplicate rotation
    assert(schedulerTickResult.rotated === false, 'Scheduler tick detected freshly active batch and skipped duplicate rotation');
    assert(schedulerTickResult.reason === 'CURRENT_BATCH_NOT_EXPIRED', 'Scheduler tick returned CURRENT_BATCH_NOT_EXPIRED');

    // Verify exactly ONE active batch exists in cycle
    activeCount = await dbPool.query(
      `SELECT COUNT(*)::int as count FROM spawn_batches WHERE cycle_id = $1 AND status = 'ACTIVE';`,
      [cycleId]
    );
    assert(activeCount.rows[0].count === 1, 'Exactly ONE active batch exists after concurrent race');

    const finalActiveBatch = await batchRepo.findActive(cycleId);
    assert(finalActiveBatch?.id === concurrentForcedBatchId, 'Final active batch matches the forced batch ID');

    console.log('\n================================================================');
    console.log('  🎉 ALL ROTATION PHASE 03 (FORCE ROTATE) AUDITS PASSED!');
    console.log('================================================================\n');
  } finally {
    if (server) {
      server.close();
    }
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

runForceRotateAuditSuite().catch((err) => {
  console.error('Force rotate audit failed with error:', err);
  process.exit(1);
});
