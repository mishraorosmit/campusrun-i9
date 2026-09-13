/**
 * Project I9 — Claim Phase 03 Integration Audit Suite
 * 
 * Verifies:
 * 1. Successful authoritative claim execution (200 OK with server-derived response:
 *    claim ID, spawn ID, spawn name, points awarded, weekly points, all-time points,
 *    authoritative claim timestamp, authoritative distance, resulting weekly rank)
 * 2. Sequential duplicate claim prevention (422 ALREADY_CLAIMED, zero additional points)
 * 3. High-concurrency duplicate claims (10 concurrent requests -> exactly 1 succeeds, 9 fail, points awarded 1x)
 * 4. Expired spawn / expired batch rejection (422 SPAWN_EXPIRED, atomic rollback)
 * 5. Out-of-range claim rejection (422 OUT_OF_RANGE, atomic rollback)
 * 6. Database transaction rollback purity (no partial claims, no orphaned points)
 * 7. Successful event emission (CLAIM_SUCCESS event published on eventBus with authoritative data;
 *    zero events emitted on failure/rollback)
 * 8. Zero-trust security (client points/distance tampering completely ignored)
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
import { transactionManager } from './server/infrastructure/database/transaction';
import { eventBus } from './server/events';
import { ClaimSuccessPayload } from './server/domain/events';
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

async function runClaimPhase03Audit() {
  console.log('================================================================');
  console.log('⚡ PROJECT I9 — CLAIM PHASE 03 COMPREHENSIVE INTEGRATION AUDIT');
  console.log('================================================================\n');

  dbPool.initialize({
    connectionString: config.DATABASE_URL,
    max: 20,
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
    // Note: default validateOnlyClaims is false -> executes authoritative claim transaction
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
  const capturedClaimSuccessEvents: ClaimSuccessPayload[] = [];

  // Register EventBus spy to capture CLAIM_SUCCESS events
  const unsubscribeEvent = eventBus.subscribe<ClaimSuccessPayload>('CLAIM_SUCCESS', (event) => {
    capturedClaimSuccessEvents.push(event.payload);
  });

  try {
    // -------------------------------------------------------------
    // SECTION 0: Setup Actors, Cycle, Active Batch & Spawns
    // -------------------------------------------------------------
    console.log('--- SECTION 0: Environment Provisioning ---');
    const student1Id = crypto.randomUUID();
    const student1Email = `phase3_student1_${Date.now()}@stanford.edu`;
    createdUserIds.push(student1Id);

    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [student1Id, student1Email]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name, total_points, season_points, claims_count)
       VALUES ($1, $2, 'Test Student 1', 100, 100, 1);`,
      [student1Id, `stud1_${Date.now()}`.substring(0, 20)]
    );

    const student1Token = JwtUtils.sign(
      { sub: student1Id, email: student1Email, username: 'student1', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );

    const student2Id = crypto.randomUUID();
    const student2Email = `phase3_student2_${Date.now()}@stanford.edu`;
    createdUserIds.push(student2Id);

    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [student2Id, student2Email]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name, total_points, season_points, claims_count)
       VALUES ($1, $2, 'Test Student 2', 500, 500, 5);`,
      [student2Id, `stud2_${Date.now()}`.substring(0, 20)]
    );

    const student2Token = JwtUtils.sign(
      { sub: student2Id, email: student2Email, username: 'student2', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );

    // Setup active weekly cycle
    await dbPool.query(`UPDATE weekly_cycles SET status = 'completed' WHERE status = 'active';`);
    const cycleId = crypto.randomUUID();
    createdCycleIds.push(cycleId);
    const cycleNum = Math.floor(Date.now() / 1000) % 2000000000;
    await dbPool.query(
      `INSERT INTO weekly_cycles (id, cycle_number, starts_at, ends_at, status)
       VALUES ($1, $2, NOW() - INTERVAL '1 day', NOW() + INTERVAL '6 days', 'active');`,
      [cycleId, cycleNum]
    );

    // Active batch
    const activeBatchId = crypto.randomUUID();
    createdBatchIds.push(activeBatchId);
    const baseBatchNum = cycleNum + 10;
    await dbPool.query(
      `INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, status, is_active)
       VALUES ($1, $2, $3, NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '35 minutes', 'ACTIVE', true);`,
      [activeBatchId, baseBatchNum + 1, cycleId]
    );

    // Expired batch
    const expiredBatchId = crypto.randomUUID();
    createdBatchIds.push(expiredBatchId);
    await dbPool.query(
      `INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, status, is_active)
       VALUES ($1, $2, $3, NOW() - INTERVAL '60 minutes', NOW() - INTERVAL '15 minutes', 'EXPIRED', false);`,
      [expiredBatchId, baseBatchNum + 2, cycleId]
    );

    // Spawns:
    // 1. Valid active spawn (Stanford Oval: 37.4290, -122.1695, 150 pts, radius 25m)
    const spawn1Id = crypto.randomUUID();
    createdSpawnIds.push(spawn1Id);
    const spawn1 = SpawnPoint.create({
      id: spawn1Id,
      code: `CP03_${Date.now().toString().slice(-4)}_1`,
      title: 'Stanford Oval Center Node',
      batchId: activeBatchId,
      coordinates: { lat: 37.4290, lng: -122.1695 },
      svgCoordinates: { x: 500, y: 500 },
      points: 150,
      tier: 'tier2',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawn1);

    // 2. Spawn for concurrency stress testing (37.4280, -122.1700, 200 pts, radius 30m)
    const spawnConcId = crypto.randomUUID();
    createdSpawnIds.push(spawnConcId);
    const spawnConc = SpawnPoint.create({
      id: spawnConcId,
      code: `CP03_${Date.now().toString().slice(-4)}_C`,
      title: 'Main Quad Concurrency Beacon',
      batchId: activeBatchId,
      coordinates: { lat: 37.4280, lng: -122.1700 },
      svgCoordinates: { x: 520, y: 520 },
      points: 200,
      tier: 'tier3',
      status: 'active',
      claimRadiusMeters: 30.0,
      enabled: true,
    });
    await spawnRepo.create(spawnConc);

    // 3. Expired spawn (linked to expired batch)
    const spawnExpiredId = crypto.randomUUID();
    createdSpawnIds.push(spawnExpiredId);
    const spawnExpired = SpawnPoint.create({
      id: spawnExpiredId,
      code: `CP03_${Date.now().toString().slice(-4)}_X`,
      title: 'Expired Gate Node',
      batchId: expiredBatchId,
      coordinates: { lat: 37.4290, lng: -122.1695 },
      svgCoordinates: { x: 530, y: 530 },
      points: 100,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawnExpired);

    console.log('✓ Provisioned actors, cycle, batches, and spawn points\n');

    // -------------------------------------------------------------
    // TEST 1: Successful Authoritative Claim & Server-Derived Values
    // -------------------------------------------------------------
    console.log('--- TEST 1: Successful Authoritative Claim Execution ---');
    // Initial profile check for student1 (started with total: 100, season: 100, claims: 1)
    const preProfile = (
      await dbPool.query<{ total_points: number; season_points: number; claims_count: number }>(
        `SELECT total_points, season_points, claims_count FROM profiles WHERE user_id = $1;`,
        [student1Id]
      )
    ).rows[0];

    // Student1 claims spawn1 (approx 2m away from 37.4290, -122.1695)
    capturedClaimSuccessEvents.length = 0; // reset event capture
    const claimRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: {
        spawnId: spawn1Id,
        latitude: 37.42901,
        longitude: -122.16951,
      },
    });

    assert(claimRes.status === 200, `Claim endpoint returns 200 OK (got ${claimRes.status})`);
    assert(claimRes.body?.success === true, 'Response body success is true');
    const claimData = claimRes.body?.data;

    // Verify all 9 server-derived values
    assert(typeof claimData?.claimId === 'string' && claimData.claimId.length > 20, '1. Authoritative claim ID returned');
    assert(claimData?.spawnId === spawn1Id, '2. Authoritative spawn ID matches');
    assert(claimData?.spawnName === 'Stanford Oval Center Node', '3. Authoritative spawn name matches');
    assert(claimData?.pointsAwarded === 150, '4. Authoritative points awarded is 150');
    assert(claimData?.weeklyPoints === preProfile.season_points + 150, `5. Authoritative weekly points updated (${claimData?.weeklyPoints})`);
    assert(claimData?.allTimePoints === preProfile.total_points + 150, `6. Authoritative all-time points updated (${claimData?.allTimePoints})`);
    assert(Boolean(claimData?.claimedAt), '7. Authoritative claim timestamp returned');
    assert(typeof claimData?.distanceMeters === 'number' && claimData.distanceMeters <= 25.0, `8. Authoritative distance returned (${claimData?.distanceMeters}m)`);
    assert(typeof claimData?.weeklyRank === 'number' && claimData.weeklyRank >= 1, `9. Resulting weekly rank returned (${claimData?.weeklyRank})`);

    // Verify database mutations
    const dbClaims = await dbPool.query(
      `SELECT * FROM claims WHERE id = $1;`,
      [claimData.claimId]
    );
    assert(dbClaims.rowCount === 1, 'Claim record exists in immutable claims table');
    assert(dbClaims.rows[0].points_awarded === 150, 'Claim table records exact authoritative points');
    assert(dbClaims.rows[0].player_id === student1Id, 'Claim table records authenticated player_id');
    assert(dbClaims.rows[0].spawn_id === spawn1Id, 'Claim table records spawn_id');
    assert(dbClaims.rows[0].batch_id === activeBatchId, 'Claim table records active batch_id');

    const postProfile = (
      await dbPool.query<{ total_points: number; season_points: number; claims_count: number }>(
        `SELECT total_points, season_points, claims_count FROM profiles WHERE user_id = $1;`,
        [student1Id]
      )
    ).rows[0];
    assert(postProfile.total_points === preProfile.total_points + 150, 'Database total_points incremented by 150');
    assert(postProfile.season_points === preProfile.season_points + 150, 'Database season_points incremented by 150');
    assert(postProfile.claims_count === preProfile.claims_count + 1, 'Database claims_count incremented by 1');

    const spawnCheck = (
      await dbPool.query<{ claim_count: number }>(
        `SELECT claim_count FROM spawn_points WHERE id = $1;`,
        [spawn1Id]
      )
    ).rows[0];
    assert(spawnCheck.claim_count === 1, 'Spawn claim_count incremented to 1');
    console.log('✓ Test 1 passed\n');

    // -------------------------------------------------------------
    // TEST 2: CLAIM_SUCCESS Domain Event Emission
    // -------------------------------------------------------------
    console.log('--- TEST 2: Domain Event Emission (CLAIM_SUCCESS) ---');
    assert(capturedClaimSuccessEvents.length === 1, 'Exactly one CLAIM_SUCCESS event was published to EventBus');
    const evt = capturedClaimSuccessEvents[0];
    assert(evt.claimId === claimData.claimId, 'Event claimId matches response claimId');
    assert(evt.spawnId === spawn1Id, 'Event spawnId matches');
    assert(evt.spawnName === 'Stanford Oval Center Node', 'Event spawnName matches');
    assert(evt.playerId === student1Id, 'Event playerId matches authenticated student1Id');
    assert(evt.pointsAwarded === 150, 'Event pointsAwarded matches authoritative 150');
    assert(evt.weeklyPoints === postProfile.season_points, 'Event weeklyPoints matches updated profile season_points');
    assert(evt.allTimePoints === postProfile.total_points, 'Event allTimePoints matches updated profile total_points');
    console.log('✓ Test 2 passed\n');

    // -------------------------------------------------------------
    // TEST 3: Duplicate Claim Prevention (Sequential)
    // -------------------------------------------------------------
    console.log('--- TEST 3: Sequential Duplicate Claim Prevention ---');
    capturedClaimSuccessEvents.length = 0; // reset
    const dupRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: {
        spawnId: spawn1Id,
        latitude: 37.42901,
        longitude: -122.16951,
      },
    });

    assert(dupRes.status === 422, `Duplicate claim returns 422 Unprocessable Entity (got ${dupRes.status})`);
    assert(dupRes.body?.error?.code === 'ALREADY_CLAIMED', 'Error code is ALREADY_CLAIMED');
    assert(dupRes.body?.success === false, 'success is false');

    // Ensure repeated identical requests CANNOT award additional points
    const dupProfile = (
      await dbPool.query<{ total_points: number; season_points: number; claims_count: number }>(
        `SELECT total_points, season_points, claims_count FROM profiles WHERE user_id = $1;`,
        [student1Id]
      )
    ).rows[0];
    assert(dupProfile.total_points === postProfile.total_points, 'Total points did NOT increase on duplicate attempt');
    assert(dupProfile.season_points === postProfile.season_points, 'Season points did NOT increase on duplicate attempt');
    assert(dupProfile.claims_count === postProfile.claims_count, 'Claims count did NOT increase on duplicate attempt');

    const totalClaimsForSpawn = (
      await dbPool.query<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM claims WHERE player_id = $1 AND spawn_id = $2;`,
        [student1Id, spawn1Id]
      )
    ).rows[0].count;
    assert(totalClaimsForSpawn === 1, 'Total claims in DB for this player and spawn remains exactly 1');

    assert(capturedClaimSuccessEvents.length === 0, 'No CLAIM_SUCCESS event emitted on duplicate claim');
    console.log('✓ Test 3 passed\n');

    // -------------------------------------------------------------
    // TEST 4: High-Concurrency Duplicate Claims (10 Concurrent Race)
    // -------------------------------------------------------------
    console.log('--- TEST 4: High-Concurrency Duplicate Claims Race Test ---');
    // Student2 attempts to claim spawnConc simultaneously with 10 parallel requests
    const preStudent2Profile = (
      await dbPool.query<{ total_points: number; season_points: number; claims_count: number }>(
        `SELECT total_points, season_points, claims_count FROM profiles WHERE user_id = $1;`,
        [student2Id]
      )
    ).rows[0];

    capturedClaimSuccessEvents.length = 0; // reset
    console.log('  Firing 10 simultaneous claim requests for Student2 on spawnConc...');
    const concurrentPromises = Array.from({ length: 10 }).map(() =>
      requestJson(`${baseUrl}/api/v1/claims`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${student2Token}` },
        body: {
          spawnId: spawnConcId,
          latitude: 37.42801,
          longitude: -122.17001,
        },
      })
    );

    const concurrentResults = await Promise.all(concurrentPromises);
    const successfulClaims = concurrentResults.filter((r) => r.status === 200);
    const rejectedClaims = concurrentResults.filter((r) => r.status === 422);

    assert(successfulClaims.length === 1, `Exactly 1 concurrent claim succeeded (got ${successfulClaims.length})`);
    assert(rejectedClaims.length === 9, `Exactly 9 concurrent claims were rejected (got ${rejectedClaims.length})`);
    for (const rej of rejectedClaims) {
      assert(rej.body?.error?.code === 'ALREADY_CLAIMED', 'Rejected concurrent claim code is ALREADY_CLAIMED');
    }

    // Database verification: points awarded exactly ONCE
    const postStudent2Profile = (
      await dbPool.query<{ total_points: number; season_points: number; claims_count: number }>(
        `SELECT total_points, season_points, claims_count FROM profiles WHERE user_id = $1;`,
        [student2Id]
      )
    ).rows[0];

    assert(
      postStudent2Profile.total_points === preStudent2Profile.total_points + 200,
      `Student2 total_points awarded exactly once (+200): ${postStudent2Profile.total_points}`
    );
    assert(
      postStudent2Profile.season_points === preStudent2Profile.season_points + 200,
      `Student2 season_points awarded exactly once (+200): ${postStudent2Profile.season_points}`
    );
    assert(
      postStudent2Profile.claims_count === preStudent2Profile.claims_count + 1,
      `Student2 claims_count incremented exactly once (+1): ${postStudent2Profile.claims_count}`
    );

    const concClaimDbCount = (
      await dbPool.query<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM claims WHERE player_id = $1 AND spawn_id = $2;`,
        [student2Id, spawnConcId]
      )
    ).rows[0].count;
    assert(concClaimDbCount === 1, 'Exactly 1 claim record persisted in DB for concurrent storm');

    assert(capturedClaimSuccessEvents.length === 1, 'Exactly 1 CLAIM_SUCCESS event emitted for the 10 concurrent requests');
    console.log('✓ Test 4 passed\n');

    // -------------------------------------------------------------
    // TEST 5: Expired Spawn / Batch Rejection & Rollback
    // -------------------------------------------------------------
    console.log('--- TEST 5: Expired Spawn Rejection & Transaction Rollback ---');
    const preExpiredProfile = (
      await dbPool.query<{ total_points: number; season_points: number }>(
        `SELECT total_points, season_points FROM profiles WHERE user_id = $1;`,
        [student1Id]
      )
    ).rows[0];

    capturedClaimSuccessEvents.length = 0;
    const expiredRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: {
        spawnId: spawnExpiredId,
        latitude: 37.4290,
        longitude: -122.1695,
      },
    });

    assert(expiredRes.status === 422, `Expired spawn claim returns 422 (got ${expiredRes.status})`);
    assert(expiredRes.body?.error?.code === 'SPAWN_EXPIRED', 'Error code is SPAWN_EXPIRED');

    // Rollback verification
    const postExpiredProfile = (
      await dbPool.query<{ total_points: number; season_points: number }>(
        `SELECT total_points, season_points FROM profiles WHERE user_id = $1;`,
        [student1Id]
      )
    ).rows[0];
    assert(postExpiredProfile.total_points === preExpiredProfile.total_points, 'Zero points awarded on expired spawn claim');
    assert(capturedClaimSuccessEvents.length === 0, 'No event emitted on expired spawn rejection');
    console.log('✓ Test 5 passed\n');

    // -------------------------------------------------------------
    // TEST 6: Out-of-Range Claim Rejection & Rollback
    // -------------------------------------------------------------
    console.log('--- TEST 6: Out-of-Range Claim Rejection & Transaction Rollback ---');
    // Spawn 1 is at (37.4290, -122.1695), radius 25m.
    // Try to claim with student 2 from 500m away (37.4335, -122.1695)
    const preOorProfile = (
      await dbPool.query<{ total_points: number; season_points: number }>(
        `SELECT total_points, season_points FROM profiles WHERE user_id = $1;`,
        [student2Id]
      )
    ).rows[0];

    capturedClaimSuccessEvents.length = 0;
    const oorRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student2Token}` },
      body: {
        spawnId: spawn1Id,
        latitude: 37.4335,
        longitude: -122.1695,
      },
    });

    assert(oorRes.status === 422, `Out-of-range claim returns 422 (got ${oorRes.status})`);
    assert(oorRes.body?.error?.code === 'OUT_OF_RANGE', 'Error code is OUT_OF_RANGE');
    assert(oorRes.body?.error?.details?.distanceMeters > 25.0, 'Server calculated distance returned in details');

    // Rollback verification
    const postOorProfile = (
      await dbPool.query<{ total_points: number; season_points: number }>(
        `SELECT total_points, season_points FROM profiles WHERE user_id = $1;`,
        [student2Id]
      )
    ).rows[0];
    assert(postOorProfile.total_points === preOorProfile.total_points, 'Zero points awarded on out-of-range claim');
    assert(capturedClaimSuccessEvents.length === 0, 'No event emitted on out-of-range rejection');
    console.log('✓ Test 6 passed\n');

    // -------------------------------------------------------------
    // TEST 7: Client Point / Distance Tampering Resistance
    // -------------------------------------------------------------
    console.log('--- TEST 7: Zero-Trust Client Tampering Resistance ---');
    // Create new spawn for tampering test
    const spawnTampId = crypto.randomUUID();
    createdSpawnIds.push(spawnTampId);
    const spawnTamp = SpawnPoint.create({
      id: spawnTampId,
      code: `CP03_${Date.now().toString().slice(-4)}_T`,
      title: 'Tamper Resistant Node',
      batchId: activeBatchId,
      coordinates: { lat: 37.4285, lng: -122.1690 },
      svgCoordinates: { x: 550, y: 550 },
      points: 75,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawnTamp);

    const preTampProfile = (
      await dbPool.query<{ total_points: number; season_points: number }>(
        `SELECT total_points, season_points FROM profiles WHERE user_id = $1;`,
        [student1Id]
      )
    ).rows[0];

    const tampRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${student1Token}` },
      body: {
        spawnId: spawnTampId,
        latitude: 37.42851,
        longitude: -122.16901,
        points: 999999, // spoofed points
        distanceMeters: 0.0001, // spoofed distance
        playerId: crypto.randomUUID(), // spoofed player
        rank: 1, // spoofed rank
      },
    });

    assert(tampRes.status === 200, `Tampered request succeeds with authoritative values (got ${tampRes.status})`);
    assert(tampRes.body?.data?.pointsAwarded === 75, 'Awarded strictly authoritative 75 points, ignoring 999999');
    assert(tampRes.body?.data?.playerId === student1Id, 'Player ID strictly attributed to JWT token');

    const postTampProfile = (
      await dbPool.query<{ total_points: number; season_points: number }>(
        `SELECT total_points, season_points FROM profiles WHERE user_id = $1;`,
        [student1Id]
      )
    ).rows[0];
    assert(
      postTampProfile.total_points === preTampProfile.total_points + 75,
      'Database points incremented by exactly 75, NOT 999999'
    );
    console.log('✓ Test 7 passed\n');

    console.log('****************************************************************');
    console.log('🎉 CLAIM PHASE 03 AUDIT: ALL 7 TEST SECTIONS PASSED 100%!');
    console.log('****************************************************************\n');
  } finally {
    unsubscribeEvent();

    console.log('--- Cleaning up test artifacts ---');
    try {
      if (createdSpawnIds.length > 0) {
        await dbPool.query(`DELETE FROM claims WHERE spawn_id = ANY($1::uuid[]);`, [createdSpawnIds]);
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

runClaimPhase03Audit().catch((err) => {
  console.error('FATAL AUDIT FAILURE:', err);
  process.exit(1);
});
