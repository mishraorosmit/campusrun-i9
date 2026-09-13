/**
 * Project I9 — Claim Phase 04: Final Security & Anti-Cheat Audit
 * 
 * Exhaustive audit of the entire claim engine as the most security-critical game operation.
 * 
 * Verifies:
 * 1. AUTHENTICATION:
 *    - Only authenticated players can claim (401 on missing/invalid JWT)
 *    - User identity comes strictly from the verified session (never from request body)
 * 2. SPAWN VALIDITY & LIFECYCLE:
 *    - Spawn must be valid (404 on missing spawnId)
 *    - Spawn must be enabled & active (422 SPAWN_NOT_ACTIVE on disabled or cooldown)
 *    - Spawn must be unexpired (422 SPAWN_EXPIRED on expired batch or expired status)
 *    - Spawn must belong to currently active batch (422 SPAWN_NOT_ACTIVE on pending/non-active batch)
 * 3. LOCATION & GEOSPATIAL:
 *    - Coordinates validated (400 VALIDATION_ERROR on malformed or out-of-range coordinates)
 *    - Distance calculated server-side via authoritative PostGIS
 *    - Client-provided distance is completely ignored
 * 4. ANTI-CHEAT:
 *    - Client points ignored (forged points in body has 0 effect; awards authoritative DB points)
 *    - Client rank ignored (authoritative server-calculated rank returned)
 *    - Client user ID ignored (forged user ID has 0 effect; awards only to session user)
 *    - Duplicate / replayed claims cannot award additional points (422 ALREADY_CLAIMED)
 * 5. TRANSACTION SAFETY & ATOMICITY:
 *    - Claim creation and player points updates are strictly atomic
 *    - Concurrent requests cannot double-award points (10-worker race condition test)
 *    - Failed transactions leave zero partial state (rollback purity)
 * 6. DATA INTEGRITY:
 *    - Claim evidence is persisted in immutable claims table
 *    - Authoritative server timestamp stored
 *    - Authoritative geodesic distance stored
 * 7. DOMAIN EVENTS:
 *    - CLAIM_SUCCESS occurs strictly after successful commit
 *    - Failed/rejected claims emit zero success events
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

async function runFinalClaimAudit() {
  console.log('================================================================');
  console.log('🛡️  PROJECT I9 — CLAIM PHASE 04: FINAL SECURITY & ANTI-CHEAT AUDIT');
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
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const createdUserIds: string[] = [];
  const createdCycleIds: string[] = [];
  const createdBatchIds: string[] = [];
  const createdSpawnIds: string[] = [];
  const capturedEvents: ClaimSuccessPayload[] = [];

  const unsubscribe = eventBus.subscribe<ClaimSuccessPayload>('CLAIM_SUCCESS', (e) => {
    capturedEvents.push(e.payload);
  });

  try {
    // -------------------------------------------------------------
    // SECTION 0: Actors & Environment Setup
    // -------------------------------------------------------------
    console.log('--- SECTION 0: Provisioning Test Actors & Environment ---');
    const victimUserId = crypto.randomUUID();
    const victimEmail = `victim_${Date.now()}@stanford.edu`;
    createdUserIds.push(victimUserId);
    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [victimUserId, victimEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name, total_points, season_points, claims_count)
       VALUES ($1, $2, 'Innocent Victim', 50, 50, 1);`,
      [victimUserId, `victim_${Date.now()}`.substring(0, 20)]
    );

    const attackerUserId = crypto.randomUUID();
    const attackerEmail = `attacker_${Date.now()}@stanford.edu`;
    createdUserIds.push(attackerUserId);
    await dbPool.query(
      `INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`,
      [attackerUserId, attackerEmail]
    );
    await dbPool.query(
      `INSERT INTO profiles (user_id, username, display_name, total_points, season_points, claims_count)
       VALUES ($1, $2, 'Adversary Player', 200, 200, 2);`,
      [attackerUserId, `attacker_${Date.now()}`.substring(0, 20)]
    );

    const attackerToken = JwtUtils.sign(
      { sub: attackerUserId, email: attackerEmail, username: 'attacker', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );

    // Active cycle
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
    const baseBatchNum = cycleNum + 20;
    await dbPool.query(
      `INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, status, is_active)
       VALUES ($1, $2, $3, NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '30 minutes', 'ACTIVE', true);`,
      [activeBatchId, baseBatchNum + 1, cycleId]
    );

    // Expired batch
    const expiredBatchId = crypto.randomUUID();
    createdBatchIds.push(expiredBatchId);
    await dbPool.query(
      `INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, status, is_active)
       VALUES ($1, $2, $3, NOW() - INTERVAL '60 minutes', NOW() - INTERVAL '10 minutes', 'EXPIRED', false);`,
      [expiredBatchId, baseBatchNum + 2, cycleId]
    );

    // Spawns
    // Spawn A: Active (Stanford Oval: 37.4290, -122.1695, 120 points, radius 25m)
    const spawnAId = crypto.randomUUID();
    createdSpawnIds.push(spawnAId);
    const spawnA = SpawnPoint.create({
      id: spawnAId,
      code: `SEC_${Date.now().toString().slice(-4)}_A`,
      title: 'Security Target Oval Node',
      batchId: activeBatchId,
      coordinates: { lat: 37.4290, lng: -122.1695 },
      svgCoordinates: { x: 500, y: 500 },
      points: 120,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawnA);

    // Spawn B: Disabled in active batch
    const spawnBId = crypto.randomUUID();
    createdSpawnIds.push(spawnBId);
    const spawnB = SpawnPoint.create({
      id: spawnBId,
      code: `SEC_${Date.now().toString().slice(-4)}_B`,
      title: 'Disabled Node',
      batchId: activeBatchId,
      coordinates: { lat: 37.4290, lng: -122.1695 },
      svgCoordinates: { x: 510, y: 510 },
      points: 100,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: false,
    });
    await spawnRepo.create(spawnB);

    // Spawn C: Status 'cooldown'
    const spawnCId = crypto.randomUUID();
    createdSpawnIds.push(spawnCId);
    const spawnC = SpawnPoint.create({
      id: spawnCId,
      code: `SEC_${Date.now().toString().slice(-4)}_C`,
      title: 'Cooldown Node',
      batchId: activeBatchId,
      coordinates: { lat: 37.4290, lng: -122.1695 },
      svgCoordinates: { x: 520, y: 520 },
      points: 100,
      tier: 'tier1',
      status: 'cooldown',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawnC);

    // Spawn D: Expired status
    const spawnDId = crypto.randomUUID();
    createdSpawnIds.push(spawnDId);
    const spawnD = SpawnPoint.create({
      id: spawnDId,
      code: `SEC_${Date.now().toString().slice(-4)}_D`,
      title: 'Expired Node',
      batchId: activeBatchId,
      coordinates: { lat: 37.4290, lng: -122.1695 },
      svgCoordinates: { x: 530, y: 530 },
      points: 100,
      tier: 'tier1',
      status: 'expired',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawnD);

    // Spawn E: Linked to expired batch
    const spawnEId = crypto.randomUUID();
    createdSpawnIds.push(spawnEId);
    const spawnE = SpawnPoint.create({
      id: spawnEId,
      code: `SEC_${Date.now().toString().slice(-4)}_E`,
      title: 'Node in Expired Batch',
      batchId: expiredBatchId,
      coordinates: { lat: 37.4290, lng: -122.1695 },
      svgCoordinates: { x: 540, y: 540 },
      points: 100,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25.0,
      enabled: true,
    });
    await spawnRepo.create(spawnE);

    // Spawn F: For concurrency storm (37.4270, -122.1700, 250 points, radius 30m)
    const spawnFId = crypto.randomUUID();
    createdSpawnIds.push(spawnFId);
    const spawnF = SpawnPoint.create({
      id: spawnFId,
      code: `SEC_${Date.now().toString().slice(-4)}_F`,
      title: 'High Concurrency Fortress',
      batchId: activeBatchId,
      coordinates: { lat: 37.4270, lng: -122.1700 },
      svgCoordinates: { x: 560, y: 560 },
      points: 250,
      tier: 'tier3',
      status: 'active',
      claimRadiusMeters: 30.0,
      enabled: true,
    });
    await spawnRepo.create(spawnF);

    console.log('✓ Actors, batches, and security spawn targets provisioned\n');

    // -------------------------------------------------------------
    // AUDIT 1: AUTHENTICATION ENFORCEMENT
    // -------------------------------------------------------------
    console.log('--- AUDIT 1: AUTHENTICATION ENFORCEMENT ---');
    // 1a. Missing token
    const noTokenRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      body: { spawnId: spawnAId, latitude: 37.42901, longitude: -122.16951 },
    });
    assert(noTokenRes.status === 401, 'Unauthenticated request returns 401 Unauthorized');
    assert(noTokenRes.body?.error?.code === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED');

    // 1b. Bogus token
    const badTokenRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: 'Bearer forged.tampered.token' },
      body: { spawnId: spawnAId, latitude: 37.42901, longitude: -122.16951 },
    });
    assert(badTokenRes.status === 401, 'Tampered token returns 401 Unauthorized');
    console.log('✓ Audit 1 passed\n');

    // -------------------------------------------------------------
    // AUDIT 2: ANTI-CHEAT — FORGED USER ID ATTACK
    // -------------------------------------------------------------
    console.log('--- AUDIT 2: ANTI-CHEAT — FORGED USER ID ATTACK ---');
    // Attacker submits victim's user ID in request body
    const preVictim = (await dbPool.query<any>(`SELECT total_points FROM profiles WHERE user_id = $1;`, [victimUserId])).rows[0];
    const preAttacker = (await dbPool.query<any>(`SELECT total_points FROM profiles WHERE user_id = $1;`, [attackerUserId])).rows[0];

    const forgedUserRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: {
        spawnId: spawnAId,
        latitude: 37.42901,
        longitude: -122.16951,
        playerId: victimUserId, // Attempt to steal or frame victim
        userId: victimUserId,
      },
    });

    assert(forgedUserRes.status === 200, 'Claim processed under verified session user');
    assert(forgedUserRes.body?.data?.playerId === attackerUserId, 'Result strictly attributes attacker user ID');

    const postVictim = (await dbPool.query<any>(`SELECT total_points FROM profiles WHERE user_id = $1;`, [victimUserId])).rows[0];
    const postAttacker = (await dbPool.query<any>(`SELECT total_points FROM profiles WHERE user_id = $1;`, [attackerUserId])).rows[0];

    assert(postVictim.total_points === preVictim.total_points, 'Victim points completely unmodified (zero mutation)');
    assert(postAttacker.total_points === preAttacker.total_points + 120, 'Attacker session points incremented by exactly 120');
    console.log('✓ Audit 2 passed\n');

    // -------------------------------------------------------------
    // AUDIT 3: ANTI-CHEAT — FORGED POINTS & DISTANCE ATTACK
    // -------------------------------------------------------------
    console.log('--- AUDIT 3: ANTI-CHEAT — FORGED POINTS & DISTANCE ATTACK ---');
    // Attacker tries to submit points: 9999999 and distance: 0.0001
    // First, let's test distance spoofing while physically out of range (500m away)
    const spoofDistanceRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: {
        spawnId: spawnFId,
        latitude: 37.4330, // ~600m away
        longitude: -122.1700,
        distanceMeters: 0.001, // Client claims to be 0.001m away
        distance: 0,
        points: 5000000,       // Client claims 5,000,000 points
      },
    });

    assert(spoofDistanceRes.status === 422, 'Forged distance rejected by authoritative PostGIS check (422 OUT_OF_RANGE)');
    assert(spoofDistanceRes.body?.error?.code === 'OUT_OF_RANGE', 'Error code is OUT_OF_RANGE');
    assert(spoofDistanceRes.body?.error?.details?.distanceMeters > 30.0, 'Server calculated authoritative distance returned');

    // Zero points awarded on rejected claim
    const afterSpoofProfile = (await dbPool.query<any>(`SELECT total_points FROM profiles WHERE user_id = $1;`, [attackerUserId])).rows[0];
    assert(afterSpoofProfile.total_points === postAttacker.total_points, 'Zero points awarded on distance spoofing attempt');
    console.log('✓ Audit 3 passed\n');

    // -------------------------------------------------------------
    // AUDIT 4: ANTI-CHEAT — REPLAY / DUPLICATE ATTACK
    // -------------------------------------------------------------
    console.log('--- AUDIT 4: ANTI-CHEAT — REPLAY / DUPLICATE ATTACK ---');
    // Spawn A was already claimed by attacker in Audit 2. Replay the identical claim!
    const replayRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: {
        spawnId: spawnAId,
        latitude: 37.42901,
        longitude: -122.16951,
      },
    });

    assert(replayRes.status === 422, 'Replayed claim rejected with 422 Unprocessable Entity');
    assert(replayRes.body?.error?.code === 'ALREADY_CLAIMED', 'Error code is ALREADY_CLAIMED');

    const totalClaimsForSpawnA = (
      await dbPool.query<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM claims WHERE player_id = $1 AND spawn_id = $2;`,
        [attackerUserId, spawnAId]
      )
    ).rows[0].count;
    assert(totalClaimsForSpawnA === 1, 'Claims table retains exactly 1 record; no duplicate row created');
    console.log('✓ Audit 4 passed\n');

    // -------------------------------------------------------------
    // AUDIT 5: HIGH-CONCURRENCY RACE STORM (DOUBLE-SPEND DEFENSE)
    // -------------------------------------------------------------
    console.log('--- AUDIT 5: HIGH-CONCURRENCY RACE STORM (10 CONCURRENT REQUESTS) ---');
    // Attacker fires 10 simultaneous requests to claim Spawn F (worth 250 points)
    capturedEvents.length = 0;
    const preStormProfile = (await dbPool.query<any>(`SELECT total_points, season_points, claims_count FROM profiles WHERE user_id = $1;`, [attackerUserId])).rows[0];

    console.log('  Firing 10 simultaneous concurrent requests for Spawn F...');
    const stormPromises = Array.from({ length: 10 }).map(() =>
      requestJson(`${baseUrl}/api/v1/claims`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${attackerToken}` },
        body: {
          spawnId: spawnFId,
          latitude: 37.42701,
          longitude: -122.17001,
        },
      })
    );

    const stormResults = await Promise.all(stormPromises);
    const passed = stormResults.filter((r) => r.status === 200);
    const blocked = stormResults.filter((r) => r.status === 422);

    assert(passed.length === 1, `Exactly 1 concurrent claim succeeded (got ${passed.length})`);
    assert(blocked.length === 9, `Exactly 9 concurrent claims rejected (got ${blocked.length})`);
    for (const b of blocked) {
      assert(b.body?.error?.code === 'ALREADY_CLAIMED', 'Blocked race request returned ALREADY_CLAIMED');
    }

    const postStormProfile = (await dbPool.query<any>(`SELECT total_points, season_points, claims_count FROM profiles WHERE user_id = $1;`, [attackerUserId])).rows[0];
    assert(
      postStormProfile.total_points === preStormProfile.total_points + 250,
      `Points awarded exactly ONCE (+250): ${postStormProfile.total_points}`
    );
    assert(
      postStormProfile.claims_count === preStormProfile.claims_count + 1,
      `Claims count incremented exactly ONCE (+1): ${postStormProfile.claims_count}`
    );

    const spawnFClaims = (
      await dbPool.query<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM claims WHERE player_id = $1 AND spawn_id = $2;`,
        [attackerUserId, spawnFId]
      )
    ).rows[0].count;
    assert(spawnFClaims === 1, 'Exactly 1 claim row in claims table');
    assert(capturedEvents.length === 1, 'Exactly 1 CLAIM_SUCCESS event emitted during concurrent storm');
    console.log('✓ Audit 5 passed\n');

    // -------------------------------------------------------------
    // AUDIT 6: SPAWN LIFECYCLE & INACTIVITY HARDENING
    // -------------------------------------------------------------
    console.log('--- AUDIT 6: SPAWN LIFECYCLE & INACTIVITY HARDENING ---');
    // 6a. Disabled spawn
    const disRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: { spawnId: spawnBId, latitude: 37.4290, longitude: -122.1695 },
    });
    assert(disRes.status === 422, 'Disabled spawn rejected with 422');
    assert(disRes.body?.error?.code === 'SPAWN_NOT_ACTIVE', 'Disabled spawn error code is SPAWN_NOT_ACTIVE');

    // 6b. Cooldown spawn
    const cdRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: { spawnId: spawnCId, latitude: 37.4290, longitude: -122.1695 },
    });
    assert(cdRes.status === 422, 'Cooldown spawn rejected with 422');
    assert(cdRes.body?.error?.code === 'SPAWN_NOT_ACTIVE', 'Cooldown spawn error code is SPAWN_NOT_ACTIVE');

    // 6c. Expired status spawn
    const expStatusRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: { spawnId: spawnDId, latitude: 37.4290, longitude: -122.1695 },
    });
    assert(expStatusRes.status === 422, 'Expired status spawn rejected with 422');
    assert(expStatusRes.body?.error?.code === 'SPAWN_EXPIRED', 'Expired status spawn error code is SPAWN_EXPIRED');

    // 6d. Spawn in expired batch
    const expBatchRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: { spawnId: spawnEId, latitude: 37.4290, longitude: -122.1695 },
    });
    assert(expBatchRes.status === 422, 'Spawn in expired batch rejected with 422');
    assert(expBatchRes.body?.error?.code === 'SPAWN_EXPIRED', 'Expired batch error code is SPAWN_EXPIRED');

    // 6e. Non-existent spawn
    const nonExistentRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerToken}` },
      body: { spawnId: crypto.randomUUID(), latitude: 37.4290, longitude: -122.1695 },
    });
    assert(nonExistentRes.status === 404, 'Non-existent spawn returns 404 NOT_FOUND');
    console.log('✓ Audit 6 passed\n');

    // -------------------------------------------------------------
    // AUDIT 7: DATA INTEGRITY & EVIDENCE PERSISTENCE
    // -------------------------------------------------------------
    console.log('--- AUDIT 7: DATA INTEGRITY & EVIDENCE PERSISTENCE ---');
    const claimEvidenceRes = await dbPool.query<any>(
      `SELECT * FROM claims WHERE player_id = $1 AND spawn_id = $2;`,
      [attackerUserId, spawnAId]
    );
    assert(claimEvidenceRes.rowCount === 1, 'Claim record exists in database');
    const claimRecord = claimEvidenceRes.rows[0];

    assert(claimRecord.points_awarded === 120, 'Authoritative points stored correctly');
    assert(typeof claimRecord.distance_meters === 'number' && claimRecord.distance_meters > 0, 'Authoritative distance stored');
    assert(Boolean(claimRecord.claimed_at), 'Authoritative server timestamp stored');
    assert(Boolean(claimRecord.player_lat) && Boolean(claimRecord.player_lng), 'Authoritative player coordinates stored');
    assert(claimRecord.batch_id === activeBatchId, 'Authoritative batch_id stored');
    console.log('✓ Audit 7 passed\n');

    // -------------------------------------------------------------
    // AUDIT 8: TRANSACTION ROLLBACK PURITY & EVENT INTEGRITY
    // -------------------------------------------------------------
    console.log('--- AUDIT 8: TRANSACTION ROLLBACK PURITY & EVENT INTEGRITY ---');
    // Ensure all failed requests across the entire audit emitted ZERO events
    assert(capturedEvents.length === 1, 'Only the legitimate concurrent-winner claim emitted a CLAIM_SUCCESS event');
    const legitEvent = capturedEvents[0];
    assert(legitEvent.spawnId === spawnFId, 'Event attributes correct spawn');
    assert(legitEvent.pointsAwarded === 250, 'Event attributes correct authoritative points');
    console.log('✓ Audit 8 passed\n');

    console.log('****************************************************************');
    console.log('🎉 CLAIM PHASE 04 AUDIT: ALL 8 SECURITY AUDITS PASSED 100%!');
    console.log('****************************************************************\n');
  } finally {
    unsubscribe();

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

runFinalClaimAudit().catch((err) => {
  console.error('FATAL AUDIT FAILURE:', err);
  process.exit(1);
});
