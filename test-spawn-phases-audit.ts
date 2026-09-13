/**
 * Project I9 — Complete Spawn Management Audit (Phases 01, 02, 03, 04)
 * 
 * Verifies:
 * 1. CRUD correctness in PostgresSpawnRepository
 * 2. Authorization (admin-only endpoints, student/unauthenticated rejection)
 * 3. Coordinate validation (finite, lat -90..90, lng -180..180)
 * 4. Campus-boundary validation (inside authoritative campus bounds)
 * 5. Minimum-separation validation (rejection of proximity violations)
 * 6. Numeric bounds (points > 0, claimRadius 5..150m, consistent SVG)
 * 7. Enable/disable behavior (idempotent, batch preservation, future batch exclusion)
 * 8. Comprehensive audit logging (admin_id, action, target_id, timestamp, result)
 * 9. Transaction safety (atomic multi-record mutations & rollback)
 * 10. Duplicate / invalid configuration rejection
 */

import http from 'http';
import crypto from 'crypto';
import { createApp } from './server/app';
import { dbPool } from './server/infrastructure/database/pool';
import { transactionManager } from './server/infrastructure/database/transaction';
import { PostgresPlayerRepository } from './server/infrastructure/repositories/postgres/PostgresPlayerRepository';
import { PostgresSpawnRepository } from './server/infrastructure/repositories/postgres/PostgresSpawnRepository';
import { PostgresGeospatialService } from './server/infrastructure/geo/PostgresGeospatialService';
import { PostgresAuditService } from './server/infrastructure/audit/PostgresAuditService';
import { AdminCreateSpawnUseCase } from './server/services/AdminCreateSpawnUseCase';
import { AdminEditSpawnUseCase } from './server/services/AdminEditSpawnUseCase';
import { AdminManageSpawnsUseCase } from './server/services/AdminManageSpawnsUseCase';
import { GetSpawnByIdUseCase } from './server/services/GetSpawnByIdUseCase';
import { ListSpawnsUseCase } from './server/services/ListSpawnsUseCase';
import { GetActiveSpawnsUseCase } from './server/services/GetActiveSpawnsUseCase';
import { SpawnPoint } from './server/domain/entities/SpawnPoint';
import { JwtUtils } from './server/infrastructure/auth/JwtUtils';
import { config } from './server/config';
import { ValidationError } from './server/errors/ValidationError';
import { NotFoundError } from './server/errors/NotFoundError';
import { Coordinates } from './server/domain/types';

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
}

async function request(
  serverUrl: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, serverUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      ...headers,
    };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const options: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: reqHeaders,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({
          status: res.statusCode || 500,
          headers: res.headers,
          body: parsed,
        });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion FAILED: ${message}`);
    throw new Error(`Assertion FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runSpawnAuditSuite() {
  console.log('================================================================');
  console.log('  PROJECT I9 — COMPLETE SPAWN MANAGEMENT AUDIT (PHASES 01 - 04)');
  console.log('================================================================\n');

  // Initialize DB pool
  dbPool.initialize({
    connectionString: config.DATABASE_URL,
    max: 10,
    min: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statementTimeoutMillis: 10000,
  });

  const createdSpawnIds: string[] = [];
  const createdCycleIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdUserIds: string[] = [];

  const spawnRepo = new PostgresSpawnRepository(dbPool);
  const geoService = new PostgresGeospatialService(dbPool);
  const auditService = new PostgresAuditService(dbPool);
  const playerRepo = new PostgresPlayerRepository(dbPool);

  const adminCreateSpawnUseCase = new AdminCreateSpawnUseCase(spawnRepo, geoService, auditService);
  const adminEditSpawnUseCase = new AdminEditSpawnUseCase(spawnRepo, geoService, auditService);
  const adminManageSpawnsUseCase = new AdminManageSpawnsUseCase(spawnRepo, auditService);
  const getSpawnByIdUseCase = new GetSpawnByIdUseCase(spawnRepo);
  const listSpawnsUseCase = new ListSpawnsUseCase(spawnRepo);
  const getActiveSpawnsUseCase = new GetActiveSpawnsUseCase(spawnRepo);

  const app = createApp({
    spawnRepo,
    playerRepo,
    geoService,
    auditService,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[Test Server] Running at ${baseUrl}\n`);

  try {
    // -------------------------------------------------------------
    // SECTION 0: Setup Test Actors & Authentication
    // -------------------------------------------------------------
    console.log('--- SECTION 0: SETUP TEST ACTORS & TOKENS ---');
    const studentId = crypto.randomUUID();
    const studentEmail = `spawn-student-${Date.now()}@${config.AUTH_COLLEGE_DOMAIN}`;
    const adminId = crypto.randomUUID();
    const adminEmail = `spawn-admin-${Date.now()}@${config.AUTH_COLLEGE_DOMAIN}`;

    createdUserIds.push(studentId, adminId);

    // Seed student
    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [studentId, studentEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name) VALUES ($1, $2, $3);`,
      [studentId, `student_${Date.now()}`.substring(0, 20), 'Test Student']
    );

    // Seed admin
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

    assert(Boolean(studentToken && adminToken), 'Generated signed test tokens for STUDENT and ADMIN');

    // -------------------------------------------------------------
    // SECTION 1: REPOSITORY CRUD & DOMAIN VALIDATION (PHASE 01)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 1: REPOSITORY CRUD & VALIDATED DOMAIN OBJECTS ---');

    // Test coordinates within campus: 37.428050, -122.173351 (D-Block Plaza)
    const testCoord1: Coordinates = { lat: 37.428050, lng: -122.173351 };
    const testSvg1 = geoService.gpsToSvg(testCoord1);
    const spawnId1 = crypto.randomUUID();
    const spawnCode1 = `SPW-AUDIT-01-${Date.now()}`.substring(0, 30);
    createdSpawnIds.push(spawnId1);

    const domainSpawn1 = SpawnPoint.create({
      id: spawnId1,
      code: spawnCode1,
      title: 'Centennial Plaza Node',
      description: 'Historical marker in central quadrangle',
      clue: 'Look beneath the bronze sundial',
      coordinates: testCoord1,
      svgCoordinates: testSvg1,
      points: 150,
      tier: 'tier2',
      claimRadiusMeters: 20.0,
      enabled: true,
      maxClaims: 50,
    });

    assert(domainSpawn1 instanceof SpawnPoint, 'SpawnPoint.create produces validated SpawnPoint domain entity');
    assert(domainSpawn1.isActive() === true, 'SpawnPoint.isActive() returns true for enabled active spawn');

    // Persist via PostgresSpawnRepository
    const createdInRepo = await spawnRepo.create(domainSpawn1);
    assert(createdInRepo instanceof SpawnPoint, 'spawnRepo.create returns validated SpawnPoint instance');
    assert(createdInRepo.id === spawnId1, 'spawnRepo.create preserves spawn ID');
    assert(createdInRepo.code === spawnCode1, 'spawnRepo.create preserves spawn code');
    assert(createdInRepo.title === 'Centennial Plaza Node', 'spawnRepo.create preserves spawn title');
    assert(createdInRepo.points === 150, 'spawnRepo.create preserves points');
    assert(createdInRepo.claimRadiusMeters === 20.0, 'spawnRepo.create preserves claim radius');
    assert(Math.abs(createdInRepo.coordinates.lat - testCoord1.lat) < 0.0001, 'spawnRepo.create correctly stores latitude');
    assert(Math.abs(createdInRepo.coordinates.lng - testCoord1.lng) < 0.0001, 'spawnRepo.create correctly stores longitude');
    assert(createdInRepo.svgCoordinates.x === testSvg1.x, 'spawnRepo.create correctly stores svgX');
    assert(createdInRepo.svgCoordinates.y === testSvg1.y, 'spawnRepo.create correctly stores svgY');

    // Read single spawn by ID
    const foundById = await spawnRepo.findById(spawnId1);
    assert(foundById !== null, 'spawnRepo.findById retrieves created spawn');
    assert(foundById instanceof SpawnPoint, 'spawnRepo.findById returns validated domain entity');
    assert(foundById?.code === spawnCode1, 'Retrieved spawn matches code');

    // Read single spawn by code
    const foundByCode = await spawnRepo.findByCode(spawnCode1);
    assert(foundByCode !== null, 'spawnRepo.findByCode retrieves spawn');
    assert(foundByCode?.id === spawnId1, 'Retrieved spawn matches ID');

    // List spawn points (findAll)
    const allSpawns = await spawnRepo.findAll({ limit: 10 });
    assert(allSpawns.length > 0, 'spawnRepo.findAll returns spawn list');
    assert(allSpawns.every((s) => s instanceof SpawnPoint), 'All items from findAll are validated SpawnPoint domain objects');
    assert(allSpawns.some((s) => s.id === spawnId1), 'Created spawn is in findAll result');

    // List active spawn points (findActive)
    const activeSpawns = await spawnRepo.findActive();
    assert(activeSpawns.every((s) => s.isActive()), 'All items from findActive are active domain objects');
    assert(activeSpawns.some((s) => s.id === spawnId1), 'Active spawn is included in findActive result');

    // Test spatial query findNearby
    const nearby = await spawnRepo.findNearby(testCoord1, 50.0);
    assert(nearby.some((s) => s.id === spawnId1), 'findNearby includes spawn within 50m radius');

    // Test spatial bounds query findWithinBounds
    const inBounds = await spawnRepo.findWithinBounds({
      northWest: { lat: 37.433, lng: -122.176 },
      southEast: { lat: 37.422, lng: -122.162 },
    });
    assert(inBounds.some((s) => s.id === spawnId1), 'findWithinBounds includes spawn inside bounding box');

    // -------------------------------------------------------------
    // SECTION 2: PRE-PERSISTENCE VALIDATIONS (PHASE 02)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 2: PRE-PERSISTENCE VALIDATIONS & SEPARATION RULES ---');

    // 2.1 Coordinate Validation (out-of-range, NaN)
    let errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'Invalid Lat Spawn',
        points: 100,
        coordinates: { lat: 95.0, lng: -122.17 },
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Out-of-range latitude (> 90) throws ValidationError');
    }
    assert(errCaught, 'Out-of-range latitude was rejected before DB mutation');

    errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'NaN Coord Spawn',
        points: 100,
        coordinates: { lat: NaN, lng: -122.17 },
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'NaN coordinate throws ValidationError');
    }
    assert(errCaught, 'NaN coordinate was rejected before DB mutation');

    // 2.2 Campus Boundary Validation (outside campus bounds)
    errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'Outside Campus Spawn',
        points: 100,
        coordinates: { lat: 37.7749, lng: -122.4194 }, // San Francisco
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Coordinate outside campus boundary throws ValidationError');
      assert(err.message.includes('outside the authoritative campus boundary'), 'Error explicitly mentions campus boundary');
    }
    assert(errCaught, 'Coordinate outside campus boundary was rejected before DB mutation');

    // 2.3 Numeric Bounds Validation (points & radius)
    errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'Negative Points Spawn',
        points: -50,
        coordinates: testCoord1,
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Negative point value throws ValidationError');
    }
    assert(errCaught, 'Negative point value was rejected');

    errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'Zero Points Spawn',
        points: 0,
        coordinates: testCoord1,
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Zero point value throws ValidationError');
    }
    assert(errCaught, 'Zero point value was rejected');

    errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'Invalid Radius Spawn',
        points: 100,
        claimRadiusMeters: 200.0, // > 150m
        coordinates: testCoord1,
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Radius exceeding 150m throws ValidationError');
    }
    assert(errCaught, 'Radius > 150m was rejected');

    errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'Tiny Radius Spawn',
        points: 100,
        claimRadiusMeters: 2.0, // < 5m
        coordinates: testCoord1,
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Radius under 5m throws ValidationError');
    }
    assert(errCaught, 'Radius < 5m was rejected');

    // 2.4 Consistent GPS/SVG Representation
    errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'Inconsistent SVG Spawn',
        points: 100,
        coordinates: testCoord1,
        svgCoordinates: { x: 1500, y: 2800 }, // Far away on canvas
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Inconsistent SVG coordinates throw ValidationError');
      assert(err.message.includes('deviate too far'), 'Error explains SVG/GPS deviation');
    }
    assert(errCaught, 'Inconsistent SVG coordinates rejected');

    // 2.5 Minimum Separation Validation
    // Location ~3m away from spawnId1 (violates 15m default separation)
    errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'Too Close Spawn',
        points: 100,
        coordinates: { lat: 37.428052, lng: -122.173350 }, // ~0.3m from spawnId1
        minSeparationMeters: 15.0,
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Location within minimum separation threshold throws ValidationError');
      assert(err.message.includes('Spatial separation violation'), 'Error mentions spatial separation violation');
    }
    assert(errCaught, 'Spawn violating minimum separation was rejected before DB mutation');

    // 2.6 Valid Creation Beyond Separation Distance
    // Place node at Center of Data Science (lat: 37.430599, lng: -122.168246) > 400m away
    const testCoord2: Coordinates = { lat: 37.430599, lng: -122.168246 };
    const validCreated = await adminCreateSpawnUseCase.execute({
      name: 'Data Science Atrium Spawn',
      points: 200,
      tier: 'tier3',
      claimRadiusMeters: 30.0,
      coordinates: testCoord2,
      minSeparationMeters: 15.0,
      adminId,
    });
    createdSpawnIds.push(validCreated.id);

    assert(validCreated instanceof SpawnPoint, 'Valid spawn created successfully as validated SpawnPoint');
    assert(validCreated.title === 'Data Science Atrium Spawn', 'Name saved properly');
    assert(validCreated.points === 200, 'Points saved properly');
    assert(validCreated.svgCoordinates.x > 0 && validCreated.svgCoordinates.y > 0, 'SVG coordinates automatically computed correctly');

    // 2.7 Editing Spawn (AdminEditSpawnUseCase)
    const edited = await adminEditSpawnUseCase.execute({
      id: validCreated.id,
      name: 'Updated Data Science Hub',
      points: 250,
      claimRadiusMeters: 35.0,
      adminId,
    });

    assert(edited.id === validCreated.id, 'Edit preserves spawn ID');
    assert(edited.title === 'Updated Data Science Hub', 'Edit updates title');
    assert(edited.points === 250, 'Edit updates points');
    assert(edited.claimRadiusMeters === 35.0, 'Edit updates claim radius');

    // Verify non-spatial edit doesn't falsely self-collide on separation check
    const nonSpatialEdit = await adminEditSpawnUseCase.execute({
      id: validCreated.id,
      coordinates: testCoord2, // exact same coordinates
      name: 'Same Coordinates Edit',
      minSeparationMeters: 15.0,
      adminId,
    });
    assert(nonSpatialEdit.title === 'Same Coordinates Edit', 'Self-coordinate edit does not trigger false separation error');

    // -------------------------------------------------------------
    // SECTION 3: ENABLE / DISABLE BEHAVIOR (PHASE 03)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 3: ENABLE / DISABLE BEHAVIOR & BATCH PRESERVATION ---');

    // 3.1 Idempotent toggle to false (disable)
    const disableResult1 = await adminManageSpawnsUseCase.toggleSpawn(validCreated.id, false, adminId);
    assert(disableResult1.enabled === false, 'toggleSpawn sets enabled to false');
    assert(disableResult1.idempotent === false, 'First toggle is not idempotent');

    // 3.2 Idempotent re-toggle to false
    const disableResult2 = await adminManageSpawnsUseCase.toggleSpawn(validCreated.id, false, adminId);
    assert(disableResult2.enabled === false, 'Second toggle preserves false state');
    assert(disableResult2.idempotent === true, 'Second toggle reports idempotent: true without error');

    // 3.3 Active Spawns exclusion check
    const activeAfterDisable = await spawnRepo.findActive();
    assert(
      !activeAfterDisable.some((s) => s.id === validCreated.id),
      'Disabled spawn is immediately excluded from findActive() results'
    );

    // 3.4 Future Batch Selection exclusion check
    const availableForBatch = await spawnRepo.findAvailableForBatch(50);
    assert(
      !availableForBatch.some((s) => s.id === validCreated.id),
      'Disabled spawn is strictly excluded from findAvailableForBatch() queries'
    );

    // 3.5 Active Batch State Preservation
    // Create an active weekly cycle and active spawn batch
    const cycleId = crypto.randomUUID();
    createdCycleIds.push(cycleId);
    await dbPool.query(`
      INSERT INTO weekly_cycles (id, cycle_number, starts_at, ends_at, status)
      VALUES ($1, $2, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '6 days', 'active');
    `, [cycleId, Math.floor(Date.now() / 1000)]);

    const batchId = crypto.randomUUID();
    createdBatchIds.push(batchId);
    await dbPool.query(`
      INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, is_active)
      VALUES ($1, $2, $3, NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '2 hours', true);
    `, [batchId, Math.floor(Date.now() / 1000), cycleId]);

    // Assign spawn to active batch
    await dbPool.query(`
      UPDATE spawn_points SET batch_id = $1, status = 'active', enabled = true WHERE id = $2;
    `, [batchId, validCreated.id]);

    // Now disable spawn that belongs to active batch
    const batchDisableResult = await adminManageSpawnsUseCase.toggleSpawn(validCreated.id, false, adminId);
    assert(batchDisableResult.enabled === false, 'Spawn in active batch can be disabled');
    assert(batchDisableResult.batchId === batchId, 'batch_id foreign key link is preserved upon disable');

    const dbCheck = await dbPool.query(`SELECT batch_id, enabled, status FROM spawn_points WHERE id = $1;`, [validCreated.id]);
    assert(dbCheck.rows[0].batch_id === batchId, 'Relational batch_id remains intact in DB (no corruption of batch state)');
    assert(dbCheck.rows[0].enabled === false, 'Enabled flag in DB is false');

    // Re-enable spawn
    const enableResult = await adminManageSpawnsUseCase.toggleSpawn(validCreated.id, true, adminId);
    assert(enableResult.enabled === true, 'toggleSpawn successfully re-enables spawn');
    assert(enableResult.previousEnabled === false, 'Previous enabled state recorded as false');

    // -------------------------------------------------------------
    // SECTION 4: HTTP API & SERVER-SIDE AUTHORIZATION
    // -------------------------------------------------------------
    console.log('\n--- SECTION 4: HTTP API & SERVER-SIDE AUTHORIZATION ---');

    // 4.1 Unauthenticated requests to admin endpoints -> 401
    const unauthCreate = await request(baseUrl, 'POST', '/api/v1/admin/spawns', {}, {
      name: 'Unauth Spawn',
      points: 100,
      coordinates: { lat: 37.428, lng: -122.173 },
    });
    assert(unauthCreate.status === 401, 'Unauthenticated POST /api/v1/admin/spawns returns 401 Unauthorized');

    const unauthToggle = await request(baseUrl, 'PATCH', `/api/v1/admin/spawns/${validCreated.id}/toggle`, {}, {
      enabled: false,
    });
    assert(unauthToggle.status === 401, 'Unauthenticated PATCH /api/v1/admin/spawns/:id/toggle returns 401 Unauthorized');

    // 4.2 STUDENT token to admin endpoints -> 403 Forbidden
    const studentCreate = await request(baseUrl, 'POST', '/api/v1/admin/spawns', {
      Authorization: `Bearer ${studentToken}`,
    }, {
      name: 'Student Spawn Attempt',
      points: 100,
      coordinates: { lat: 37.428, lng: -122.173 },
    });
    assert(studentCreate.status === 403, 'STUDENT token to POST /api/v1/admin/spawns returns 403 Forbidden');

    const studentToggle = await request(baseUrl, 'PATCH', `/api/v1/admin/spawns/${validCreated.id}/toggle`, {
      Authorization: `Bearer ${studentToken}`,
    }, {
      enabled: false,
    });
    assert(studentToggle.status === 403, 'STUDENT token to PATCH /api/v1/admin/spawns/:id/toggle returns 403 Forbidden');

    // 4.3 ADMIN token to admin endpoints -> 201 / 200
    const testCoord3: Coordinates = { lat: 37.424572, lng: -122.168437 }; // Lecture Hall 3
    const adminCreateRes = await request(baseUrl, 'POST', '/api/v1/admin/spawns', {
      Authorization: `Bearer ${adminToken}`,
    }, {
      name: 'LH-3 Breezeway Spawn',
      points: 120,
      claimRadiusMeters: 25.0,
      coordinates: testCoord3,
      enabled: true,
    });
    assert(adminCreateRes.status === 201, 'ADMIN token to POST /api/v1/admin/spawns returns 201 Created');
    assert(adminCreateRes.body.success === true, 'Response body success is true');
    assert(adminCreateRes.body.data.title === 'LH-3 Breezeway Spawn', 'Response body contains created spawn data');
    const httpSpawnId = adminCreateRes.body.data.id;
    createdSpawnIds.push(httpSpawnId);

    // ADMIN edit
    const adminEditRes = await request(baseUrl, 'PATCH', `/api/v1/admin/spawns/${httpSpawnId}`, {
      Authorization: `Bearer ${adminToken}`,
    }, {
      name: 'LH-3 Breezeway Spawn (Renamed)',
      points: 130,
    });
    assert(adminEditRes.status === 200, 'ADMIN token to PATCH /api/v1/admin/spawns/:id returns 200 OK');
    assert(adminEditRes.body.data.title === 'LH-3 Breezeway Spawn (Renamed)', 'Response body reflects updated name');

    // ADMIN toggle
    const adminToggleRes = await request(baseUrl, 'PATCH', `/api/v1/admin/spawns/${httpSpawnId}/toggle`, {
      Authorization: `Bearer ${adminToken}`,
    }, {
      enabled: false,
    });
    assert(adminToggleRes.status === 200, 'ADMIN token to toggle returns 200 OK');
    assert(adminToggleRes.body.data.enabled === false, 'Toggle returns enabled: false');

    // 4.4 Public Read Endpoints
    const publicList = await request(baseUrl, 'GET', '/api/v1/spawns');
    assert(publicList.status === 200, 'GET /api/v1/spawns returns 200 OK');
    assert(Array.isArray(publicList.body.data), 'GET /api/v1/spawns returns array of spawns');

    const publicActive = await request(baseUrl, 'GET', '/api/v1/spawns/active');
    assert(publicActive.status === 200, 'GET /api/v1/spawns/active returns 200 OK');

    const publicSingle = await request(baseUrl, 'GET', `/api/v1/spawns/${httpSpawnId}`);
    assert(publicSingle.status === 200, 'GET /api/v1/spawns/:id returns 200 OK');
    assert(publicSingle.body.data.id === httpSpawnId, 'GET /api/v1/spawns/:id returns requested spawn');

    // 4.5 Clean Architecture Check: SpawnController has ZERO DB pool access
    const controllerCode = await import('fs').then((fs) =>
      fs.readFileSync('server/controllers/SpawnController.ts', 'utf8')
    );
    assert(!controllerCode.includes('dbPool'), 'SpawnController has zero dbPool references');
    assert(!controllerCode.includes('SELECT '), 'SpawnController has zero SQL statements');

    // -------------------------------------------------------------
    // SECTION 5: AUDIT LOGGING VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- SECTION 5: AUDIT LOGGING VERIFICATION ---');

    // Wait a brief moment for asynchronous audit write
    await new Promise((r) => setTimeout(r, 200));

    const auditLogs = await auditService.queryLogs({ limit: 50 });
    assert(auditLogs.length > 0, 'Audit logs were successfully written to PostgreSQL audit_logs table');

    const createLogs = auditLogs.filter((l) => l.action === 'SPAWN_CREATE');
    assert(createLogs.length > 0, 'audit_logs contains SPAWN_CREATE entries');
    assert(createLogs.some((l) => l.adminId === adminId), 'SPAWN_CREATE log contains correct adminId');
    assert(createLogs.some((l) => l.details?.result === 'SUCCESS'), 'SPAWN_CREATE log contains result: SUCCESS');

    const editLogs = auditLogs.filter((l) => l.action === 'SPAWN_EDIT');
    assert(editLogs.length > 0, 'audit_logs contains SPAWN_EDIT entries');
    assert(editLogs.some((l) => l.targetId === httpSpawnId), 'SPAWN_EDIT log contains correct targetId');

    const toggleLogs = auditLogs.filter((l) => l.action === 'SPAWN_TOGGLE');
    assert(toggleLogs.length > 0, 'audit_logs contains SPAWN_TOGGLE entries');
    assert(toggleLogs.some((l) => l.targetId === validCreated.id || l.targetId === httpSpawnId), 'SPAWN_TOGGLE contains valid spawn targetId');

    // Verify denied attempt was audited
    const deniedLogs = auditLogs.filter((l) => l.details?.result === 'DENIED');
    assert(deniedLogs.length > 0, 'audit_logs contains records of unauthorized mutation attempts (DENIED)');

    // -------------------------------------------------------------
    // SECTION 6: TRANSACTION SAFETY (ATOMICITY & ROLLBACK)
    // -------------------------------------------------------------
    console.log('\n--- SECTION 6: TRANSACTION SAFETY & ROLLBACK ---');

    let rollbackTriggered = false;
    const rollbackSpawnId = crypto.randomUUID();
    const rollbackSpawnCode = `SPW-RB-${Date.now()}`.substring(0, 30);
    createdSpawnIds.push(rollbackSpawnId);

    try {
      await transactionManager.runInTransaction(async (tx) => {
        const dummySpawn = SpawnPoint.create({
          id: rollbackSpawnId,
          code: rollbackSpawnCode,
          title: 'Rollback Test Node',
          coordinates: { lat: 37.427, lng: -122.170 },
          svgCoordinates: { x: 500, y: 500 },
          points: 100,
        });

        // Insert within transaction
        await spawnRepo.create(dummySpawn, tx);

        // Force intentional error inside transaction work
        throw new Error('Simulated transaction failure for atomicity test');
      });
    } catch (err: any) {
      rollbackTriggered = true;
      assert(err.message.includes('Simulated transaction failure'), 'Transaction failed as expected');
    }

    assert(rollbackTriggered, 'Transaction error was thrown');
    const checkRolledBack = await spawnRepo.findById(rollbackSpawnId);
    assert(checkRolledBack === null, 'Transaction rollback successfully prevented partial commit in PostgreSQL');

    // -------------------------------------------------------------
    // SECTION 7: DUPLICATE / INVALID CONFIGURATIONS
    // -------------------------------------------------------------
    console.log('\n--- SECTION 7: DUPLICATE & INVALID CONFIGURATIONS ---');

    // Attempt to create spawn with existing code
    errCaught = false;
    try {
      await adminCreateSpawnUseCase.execute({
        name: 'Duplicate Code Spawn',
        code: spawnCode1, // Already used by spawnId1
        points: 100,
        coordinates: { lat: 37.426, lng: -122.172 },
        adminId,
      });
    } catch (err: any) {
      errCaught = true;
    }
    assert(errCaught, 'Duplicate spawn code was rejected');

    // Attempt to create spawn with code < 3 characters
    errCaught = false;
    try {
      SpawnPoint.create({
        code: 'AB',
        title: 'Short Code Node',
        coordinates: { lat: 37.426, lng: -122.172 },
        svgCoordinates: { x: 500, y: 500 },
        points: 100,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Code with fewer than 3 characters rejected with ValidationError');
    }
    assert(errCaught, 'Short code was rejected');

    // Attempt to create spawn with empty title
    errCaught = false;
    try {
      SpawnPoint.create({
        code: 'VALID-CODE',
        title: '   ',
        coordinates: { lat: 37.426, lng: -122.172 },
        svgCoordinates: { x: 500, y: 500 },
        points: 100,
      });
    } catch (err: any) {
      errCaught = true;
      assert(err instanceof ValidationError, 'Empty title rejected with ValidationError');
    }
    assert(errCaught, 'Empty title was rejected');

    console.log('\n================================================================');
    console.log('  🎉 ALL SPAWN MANAGEMENT PHASES 01, 02, 03, 04 AUDITS PASSED!');
    console.log('================================================================\n');
  } finally {
    // Teardown test artifacts from PostgreSQL
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
      if (createdUserIds.length > 0) {
        await dbPool.query(`DELETE FROM audit_logs WHERE admin_id = ANY($1::uuid[]);`, [createdUserIds]);
        await dbPool.query(`DELETE FROM admins WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        await dbPool.query(`DELETE FROM profiles WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        await dbPool.query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [createdUserIds]);
      }
      console.log('[Cleanup] Cleanup complete.');
    } catch (cleanupErr) {
      console.error('[Cleanup] Error during teardown:', cleanupErr);
    }

    server.close();
    await dbPool.shutdown();
  }
}

runSpawnAuditSuite().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
