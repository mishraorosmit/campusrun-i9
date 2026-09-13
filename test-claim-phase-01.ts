/**
 * Project I9 — Claim Phase 01 Audit Suite
 * 
 * Verifies:
 * 1. Authentication requirement (requireAuthenticatedUser: 401 without Bearer token)
 * 2. Request schema & coordinate range validation (400 on malformed/out-of-range coordinates or missing spawnId)
 * 3. Invalid spawn detection (404 on non-existent spawnId)
 * 4. Inactive spawn handling (422 SPAWN_NOT_ACTIVE when disabled, status != 'active', or batch != active)
 * 5. Expired spawn/batch handling (422 SPAWN_EXPIRED when batch or spawn is expired)
 * 6. Out-of-range detection (422 OUT_OF_RANGE with server-calculated distanceMeters > claimRadiusMeters)
 * 7. Valid in-range claim validation (200 OK returning structured validation payload)
 * 8. Zero-write guarantee (Phase 01 does NOT write claims or award points to database)
 * 9. Duplicate claim prevention (422 ALREADY_CLAIMED when claim already exists in claims ledger)
 * 10. Zero-trust security (client playerId/points/distance completely ignored)
 */

import http from 'http';
import crypto from 'crypto';
import { JwtUtils } from './server/infrastructure/auth/JwtUtils';
import { createApp } from './server/app';
import { config } from './server/config';
import { dbPool } from './server/infrastructure/database/pool';
import { PostgresBatchRepository } from './server/infrastructure/repositories/postgres/PostgresBatchRepository';
import { PostgresSpawnRepository } from './server/infrastructure/repositories/postgres/PostgresSpawnRepository';
import { PostgresClaimRepository } from './server/infrastructure/repositories/postgres/PostgresClaimRepository';
import { PostgresGeospatialService } from './server/infrastructure/geo/PostgresGeospatialService';
import { SpawnBatch } from './server/domain/entities/SpawnBatch';
import { SpawnPoint } from './server/domain/entities/SpawnPoint';
import { Coordinates } from './server/domain/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ Assertion FAILED: ${message}`);
    throw new Error(`Assertion FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function requestJson(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: any } = {}
) {
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
          let parsedBody = raw;
          try {
            parsedBody = JSON.parse(raw);
          } catch {
            // keep raw text
          }
          resolve({ status: res.statusCode || 500, body: parsedBody });
        });
      }
    );

    req.on('error', reject);
    if (bodyData) {
      req.write(bodyData);
    }
    req.end();
  });
}

async function runClaimPhase01Audit() {
  console.log('================================================================');
  console.log('⚡ PROJECT I9 — CLAIM PHASE 01 COMPREHENSIVE AUDIT');
  console.log('================================================================\n');

  dbPool.initialize({
    connectionString: config.DATABASE_URL,
    max: 15,
    min: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statementTimeoutMillis: 10000,
  });

  const spawnRepo = new PostgresSpawnRepository(dbPool);
  const batchRepo = new PostgresBatchRepository(dbPool);
  const claimRepo = new PostgresClaimRepository(dbPool);
  const geoService = new PostgresGeospatialService(dbPool);

  const app = createApp({
    spawnRepo,
    batchRepo,
    claimRepo,
    geoService,
    validateOnlyClaims: true,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const createdUserIds: string[] = [];
  const createdCycleIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdSpawnIds: string[] = [];
  const createdClaimIds: string[] = [];

  try {
    // 0. Seed Test Users
    console.log('--- SECTION 0: Test User Provisioning ---');
    const studentId = crypto.randomUUID();
    const studentEmail = `claim_tester_${Date.now()}@stanford.edu`;
    createdUserIds.push(studentId);

    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [studentId, studentEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name) VALUES ($1, $2, 'Claim Tester');`,
      [studentId, `claim_tester_${Date.now()}`.substring(0, 20)]
    );

    const studentToken = JwtUtils.sign(
      { sub: studentId, email: studentEmail, username: 'claim_tester', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );

    const otherStudentId = crypto.randomUUID();
    const otherStudentEmail = `claim_other_${Date.now()}@stanford.edu`;
    createdUserIds.push(otherStudentId);

    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [otherStudentId, otherStudentEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name) VALUES ($1, $2, 'Other Player');`,
      [otherStudentId, `claim_other_${Date.now()}`.substring(0, 20)]
    );

    const otherStudentToken = JwtUtils.sign(
      { sub: otherStudentId, email: otherStudentEmail, username: 'claim_other', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );

    console.log('✓ Provisioned authenticated test users and JWTs\n');

    // 1. Seed Weekly Cycle & Active Batch with Spawns
    console.log('--- SECTION 1: Active Batch & Spawns Setup ---');
    await dbPool.query(`UPDATE weekly_cycles SET status = 'completed' WHERE status = 'active';`);

    const cycleId = crypto.randomUUID();
    createdCycleIds.push(cycleId);
    const cycleNumber = Math.floor(Date.now() / 1000) % 2000000000;
    await dbPool.query(
      `INSERT INTO weekly_cycles (id, cycle_number, starts_at, ends_at, status)
       VALUES ($1, $2, NOW() - INTERVAL '1 day', NOW() + INTERVAL '6 days', 'active');`,
      [cycleId, cycleNumber]
    );

    const baseBatchNumber = cycleNumber + 10;
    const activeBatchId = crypto.randomUUID();
    createdBatchIds.push(activeBatchId);
    await dbPool.query(
      `INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, status, is_active)
       VALUES ($1, $2, $3, NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '30 minutes', 'ACTIVE', true);`,
      [activeBatchId, baseBatchNumber + 1, cycleId]
    );

    // Spawn 1: Active, enabled, within Stanford campus
    // Stanford Main Quad: approx 37.4275, -122.1697
    const spawnActiveId = crypto.randomUUID();
    createdSpawnIds.push(spawnActiveId);
    const spawn1 = SpawnPoint.create({
      id: spawnActiveId,
      code: `CP01_${Date.now().toString().slice(-4)}_A`,
      title: 'Stanford Memorial Church Quad',
      batchId: activeBatchId,
      coordinates: { lat: 37.4275, lng: -122.1697 },
      svgCoordinates: { x: 500, y: 500 },
      points: 150,
      tier: 'tier2',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawn1);

    // Spawn 2: Disabled spawn in active batch
    const spawnDisabledId = crypto.randomUUID();
    createdSpawnIds.push(spawnDisabledId);
    const spawn2 = SpawnPoint.create({
      id: spawnDisabledId,
      code: `CP01_${Date.now().toString().slice(-4)}_D`,
      title: 'Disabled Hoover Tower Point',
      batchId: activeBatchId,
      coordinates: { lat: 37.4275, lng: -122.1697 },
      svgCoordinates: { x: 510, y: 510 },
      points: 100,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: false,
    });
    await spawnRepo.create(spawn2);

    // Spawn 3: Inactive status spawn (e.g. cooldown) in active batch
    const spawnCooldownId = crypto.randomUUID();
    createdSpawnIds.push(spawnCooldownId);
    const spawn3 = SpawnPoint.create({
      id: spawnCooldownId,
      code: `CP01_${Date.now().toString().slice(-4)}_C`,
      title: 'Cooldown White Plaza Point',
      batchId: activeBatchId,
      coordinates: { lat: 37.4275, lng: -122.1697 },
      svgCoordinates: { x: 520, y: 520 },
      points: 100,
      tier: 'tier1',
      status: 'cooldown',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawn3);

    // Spawn 4: Spawn belonging to an EXPIRED batch
    const expiredBatchId = crypto.randomUUID();
    createdBatchIds.push(expiredBatchId);
    await dbPool.query(
      `INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, status, is_active)
       VALUES ($1, $2, $3, NOW() - INTERVAL '60 minutes', NOW() - INTERVAL '15 minutes', 'EXPIRED', false);`,
      [expiredBatchId, baseBatchNumber + 2, cycleId]
    );

    const spawnExpiredId = crypto.randomUUID();
    createdSpawnIds.push(spawnExpiredId);
    const spawn4 = SpawnPoint.create({
      id: spawnExpiredId,
      code: `CP01_${Date.now().toString().slice(-4)}_X`,
      title: 'Old Expired Engineering Quad Point',
      batchId: expiredBatchId,
      coordinates: { lat: 37.4275, lng: -122.1697 },
      svgCoordinates: { x: 530, y: 530 },
      points: 100,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawn4);

    // Spawn 5: Spawn belonging to a CREATED (not active) batch
    const createdBatchId = crypto.randomUUID();
    createdBatchIds.push(createdBatchId);
    await dbPool.query(
      `INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, status, is_active)
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes', NOW() + INTERVAL '75 minutes', 'CREATED', false);`,
      [createdBatchId, baseBatchNumber + 3, cycleId]
    );

    const spawnCreatedBatchId = crypto.randomUUID();
    createdSpawnIds.push(spawnCreatedBatchId);
    const spawn5 = SpawnPoint.create({
      id: spawnCreatedBatchId,
      code: `CP01_${Date.now().toString().slice(-4)}_P`,
      title: 'Pending Created Batch Point',
      batchId: createdBatchId,
      coordinates: { lat: 37.4275, lng: -122.1697 },
      svgCoordinates: { x: 540, y: 540 },
      points: 100,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawn5);

    console.log('✓ Provisioned test batches and spawns\n');

    // -------------------------------------------------------------
    // TEST 1: Unauthenticated request
    // -------------------------------------------------------------
    console.log('--- TEST 1: Unauthenticated Request Enforcement ---');
    const unauthRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      body: {
        spawnId: spawnActiveId,
        latitude: 37.4275,
        longitude: -122.1697,
      },
    });
    assert(unauthRes.status === 401, `Unauthenticated request returns 401 Unauthorized (got ${unauthRes.status})`);
    assert(
      unauthRes.body?.error?.code === 'UNAUTHORIZED',
      `Error code is UNAUTHORIZED (got ${unauthRes.body?.error?.code})`
    );
    console.log('✓ Test 1 passed\n');

    // -------------------------------------------------------------
    // TEST 2: Malformed coordinates & invalid schema
    // -------------------------------------------------------------
    console.log('--- TEST 2: Request Schema & Coordinate Validation ---');
    // Missing latitude
    const missingLatRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnActiveId,
        longitude: -122.1697,
      },
    });
    assert(missingLatRes.status === 400, `Missing latitude returns 400 Bad Request (got ${missingLatRes.status})`);
    assert(missingLatRes.body?.error?.code === 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR');

    // Latitude > 90
    const outOfRangeLatRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnActiveId,
        latitude: 91.5,
        longitude: -122.1697,
      },
    });
    assert(outOfRangeLatRes.status === 400, `Latitude > 90 returns 400 Bad Request (got ${outOfRangeLatRes.status})`);
    assert(outOfRangeLatRes.body?.error?.code === 'VALIDATION_ERROR', 'Error code is VALIDATION_ERROR');

    // Longitude < -180
    const outOfRangeLngRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnActiveId,
        latitude: 37.4275,
        longitude: -185.0,
      },
    });
    assert(outOfRangeLngRes.status === 400, `Longitude < -180 returns 400 Bad Request (got ${outOfRangeLngRes.status})`);

    // Non-numeric coordinate string
    const stringCoordRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnActiveId,
        latitude: 'not_a_latitude',
        longitude: -122.1697,
      },
    });
    assert(stringCoordRes.status === 400, `String coordinate returns 400 Bad Request (got ${stringCoordRes.status})`);

    // Missing spawnId
    const missingSpawnIdRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        latitude: 37.4275,
        longitude: -122.1697,
      },
    });
    assert(missingSpawnIdRes.status === 400, `Missing spawnId returns 400 Bad Request (got ${missingSpawnIdRes.status})`);
    console.log('✓ Test 2 passed\n');

    // -------------------------------------------------------------
    // TEST 3: Invalid spawn (non-existent spawnId)
    // -------------------------------------------------------------
    console.log('--- TEST 3: Invalid Spawn (Non-Existent) ---');
    const nonExistentSpawnId = crypto.randomUUID();
    const invalidSpawnRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: nonExistentSpawnId,
        latitude: 37.4275,
        longitude: -122.1697,
      },
    });
    assert(invalidSpawnRes.status === 404, `Non-existent spawn returns 404 Not Found (got ${invalidSpawnRes.status})`);
    assert(
      invalidSpawnRes.body?.error?.code === 'NOT_FOUND',
      `Error code is NOT_FOUND (got ${invalidSpawnRes.body?.error?.code})`
    );
    console.log('✓ Test 3 passed\n');

    // -------------------------------------------------------------
    // TEST 4: Inactive spawn
    // -------------------------------------------------------------
    console.log('--- TEST 4: Inactive Spawn Checks ---');
    // 4a. Disabled spawn in active batch
    const disabledRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnDisabledId,
        latitude: 37.4275,
        longitude: -122.1697,
      },
    });
    assert(disabledRes.status === 422, `Disabled spawn returns 422 Unprocessable Entity (got ${disabledRes.status})`);
    assert(
      disabledRes.body?.error?.code === 'SPAWN_NOT_ACTIVE',
      `Error code is SPAWN_NOT_ACTIVE (got ${disabledRes.body?.error?.code})`
    );

    // 4b. Status != 'active' (e.g. cooldown)
    const cooldownRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnCooldownId,
        latitude: 37.4275,
        longitude: -122.1697,
      },
    });
    assert(cooldownRes.status === 422, `Cooldown spawn returns 422 Unprocessable Entity (got ${cooldownRes.status})`);
    assert(
      cooldownRes.body?.error?.code === 'SPAWN_NOT_ACTIVE',
      `Error code is SPAWN_NOT_ACTIVE (got ${cooldownRes.body?.error?.code})`
    );

    // 4c. Belongs to non-active batch (CREATED batch)
    const nonActiveBatchRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnCreatedBatchId,
        latitude: 37.4275,
        longitude: -122.1697,
      },
    });
    assert(nonActiveBatchRes.status === 422, `Spawn in CREATED batch returns 422 Unprocessable (got ${nonActiveBatchRes.status})`);
    assert(
      nonActiveBatchRes.body?.error?.code === 'SPAWN_NOT_ACTIVE',
      `Error code is SPAWN_NOT_ACTIVE (got ${nonActiveBatchRes.body?.error?.code})`
    );
    console.log('✓ Test 4 passed\n');

    // -------------------------------------------------------------
    // TEST 5: Expired spawn / batch
    // -------------------------------------------------------------
    console.log('--- TEST 5: Expired Spawn / Batch Checks ---');
    const expiredRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnExpiredId,
        latitude: 37.4275,
        longitude: -122.1697,
      },
    });
    assert(expiredRes.status === 422, `Spawn in EXPIRED batch returns 422 Unprocessable (got ${expiredRes.status})`);
    assert(
      expiredRes.body?.error?.code === 'SPAWN_EXPIRED',
      `Error code is SPAWN_EXPIRED (got ${expiredRes.body?.error?.code})`
    );
    console.log('✓ Test 5 passed\n');

    // -------------------------------------------------------------
    // TEST 6: Out-of-range player (geospatial distance verification)
    // -------------------------------------------------------------
    console.log('--- TEST 6: Out-of-Range Player (Geospatial Calculation) ---');
    // Spawn is at (37.4275, -122.1697) with radius 25.0m
    // Coordinate ~500m away (e.g. 37.4320, -122.1697)
    const outOfRangeRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnActiveId,
        latitude: 37.4320,
        longitude: -122.1697,
      },
    });
    assert(outOfRangeRes.status === 422, `Out-of-range returns 422 Unprocessable Entity (got ${outOfRangeRes.status})`);
    assert(
      outOfRangeRes.body?.error?.code === 'OUT_OF_RANGE',
      `Error code is OUT_OF_RANGE (got ${outOfRangeRes.body?.error?.code})`
    );
    assert(
      typeof outOfRangeRes.body?.error?.details?.distanceMeters === 'number',
      'Server-calculated distanceMeters returned in error details'
    );
    assert(
      outOfRangeRes.body?.error?.details?.distanceMeters > 25.0,
      `Calculated distance (${outOfRangeRes.body?.error?.details?.distanceMeters}m) exceeds radius (25m)`
    );
    console.log('✓ Test 6 passed\n');

    // -------------------------------------------------------------
    // TEST 7: Valid in-range player & zero-write guarantee
    // -------------------------------------------------------------
    console.log('--- TEST 7: Valid In-Range Player & Zero-Write Check ---');
    // Coordinates within 5 meters of spawn
    // (37.42750, -122.16970) -> ~2 meters offset
    const validRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnActiveId,
        latitude: 37.42751,
        longitude: -122.16971,
      },
    });
    assert(validRes.status === 200, `Valid in-range claim returns 200 OK (got ${validRes.status})`);
    assert(validRes.body?.success === true, 'Response indicates success: true');
    const claimData = validRes.body?.data;
    assert(claimData?.valid === true, 'claimData.valid is true');
    assert(claimData?.spawnId === spawnActiveId, `claimData.spawnId matches (${claimData?.spawnId})`);
    assert(claimData?.spawnCode === spawn1.code, `claimData.spawnCode matches (${claimData?.spawnCode})`);
    assert(claimData?.points === 150, `claimData.points is authoritative 150 (got ${claimData?.points})`);
    assert(claimData?.playerId === studentId, `claimData.playerId matches JWT player (${studentId})`);
    assert(claimData?.batchId === activeBatchId, `claimData.batchId matches active batch (${activeBatchId})`);
    assert(claimData?.distanceMeters <= 25.0, `claimData.distanceMeters is within 25.0m (${claimData?.distanceMeters}m)`);
    assert(Boolean(claimData?.validatedAt), 'claimData.validatedAt is present');

    // CRITICAL: Phase 01 must NOT write any claim records to database
    const claimDbCheck = await dbPool.query(
      `SELECT COUNT(*)::int as count FROM claims WHERE player_id = $1 AND spawn_id = $2;`,
      [studentId, spawnActiveId]
    );
    assert(
      claimDbCheck.rows[0].count === 0,
      'Zero-write guarantee confirmed: No claim record written to database in Phase 01'
    );
    console.log('✓ Test 7 passed\n');

    // -------------------------------------------------------------
    // TEST 8: Zero-Trust Security (Client Tampering Prevention)
    // -------------------------------------------------------------
    console.log('--- TEST 8: Zero-Trust Security (Client Tampering Prevention) ---');
    const spoofedUserId = crypto.randomUUID();
    const tamperingRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnActiveId,
        latitude: 37.42751,
        longitude: -122.16971,
        playerId: spoofedUserId, // Tampered client player ID
        points: 999999,          // Tampered points
        distanceMeters: 0.001,   // Spoofed client distance
        rank: 'GRANDMASTER',     // Spoofed rank
      },
    });
    assert(tamperingRes.status === 200, `Tampered request processed successfully (got ${tamperingRes.status})`);
    const tamperedData = tamperingRes.body?.data;
    assert(
      tamperedData?.playerId === studentId,
      `Authoritative playerId strictly taken from JWT (${studentId}), ignoring client body (${spoofedUserId})`
    );
    assert(
      tamperedData?.points === 150,
      `Authoritative points strictly taken from spawn DB record (150), ignoring client points (999999)`
    );
    assert(
      tamperedData?.distanceMeters > 0.5,
      `Authoritative distance strictly computed server-side (${tamperedData?.distanceMeters}m), ignoring client (0.001m)`
    );
    console.log('✓ Test 8 passed\n');

    // -------------------------------------------------------------
    // TEST 9: Duplicate Claim Detection
    // -------------------------------------------------------------
    console.log('--- TEST 9: Duplicate Claim Detection ---');
    // Now simulate an already-recorded claim in the immutable claims table
    const recordedClaimId = crypto.randomUUID();
    createdClaimIds.push(recordedClaimId);
    await dbPool.query(
      `INSERT INTO claims (
        id, player_id, spawn_id, batch_id, points_awarded, streak_multiplier,
        distance_meters, player_location, claimed_at
      ) VALUES (
        $1, $2, $3, $4, 150, 1.00,
        2.5, point(-122.16971, 37.42751), NOW()
      );`,
      [recordedClaimId, studentId, spawnActiveId, activeBatchId]
    );

    // Now player tries to claim the same spawn in the same batch again
    const duplicateRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        spawnId: spawnActiveId,
        latitude: 37.42751,
        longitude: -122.16971,
      },
    });
    assert(duplicateRes.status === 422, `Duplicate claim returns 422 Unprocessable (got ${duplicateRes.status})`);
    assert(
      duplicateRes.body?.error?.code === 'ALREADY_CLAIMED',
      `Error code is ALREADY_CLAIMED (got ${duplicateRes.body?.error?.code})`
    );

    // Other player has NOT claimed it, so other player should still succeed!
    const otherPlayerRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherStudentToken}` },
      body: {
        spawnId: spawnActiveId,
        latitude: 37.42751,
        longitude: -122.16971,
      },
    });
    assert(
      otherPlayerRes.status === 200,
      `Other player can still validate claim on same spawn (got ${otherPlayerRes.status})`
    );
    assert(otherPlayerRes.body?.data?.playerId === otherStudentId, 'Other player received valid claim validation');
    console.log('✓ Test 9 passed\n');

    console.log('****************************************************************');
    console.log('🎉 CLAIM PHASE 01 AUDIT: ALL 9 TEST SECTIONS PASSED 100%!');
    console.log('****************************************************************');
  } finally {
    // Teardown and cleanup
    console.log('\n--- Cleaning up test artifacts ---');
    try {
      if (createdClaimIds.length > 0) {
        await dbPool.query(`DELETE FROM claims WHERE id = ANY($1::uuid[]);`, [createdClaimIds]);
      }
      if (createdSpawnIds.length > 0) {
        await dbPool.query(`DELETE FROM spawn_points WHERE id = ANY($1::uuid[]);`, [createdSpawnIds]);
      }
      if (createdBatchIds.length > 0) {
        await dbPool.query(`DELETE FROM spawn_batches WHERE id = ANY($1::uuid[]);`, [createdBatchIds]);
      }
      if (createdCycleIds.length > 0) {
        await dbPool.query(`DELETE FROM weekly_cycles WHERE id = ANY($1::uuid[]);`, [createdCycleIds]);
      }
      if (createdUserIds.length > 0) {
        await dbPool.query(`DELETE FROM profiles WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        await dbPool.query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [createdUserIds]);
      }
    } catch (cleanupErr) {
      console.error('Cleanup warning:', cleanupErr);
    }

    server.close();
    await dbPool.shutdown();
  }
}

runClaimPhase01Audit().catch((err) => {
  console.error('FATAL AUDIT FAILURE:', err);
  process.exit(1);
});
