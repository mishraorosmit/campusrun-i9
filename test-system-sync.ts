/**
 * Project I9 — Comprehensive Cross-Layer System Sync & Integration Audit
 * 
 * Verifies that the Frontend, Backend API, PostgreSQL Database, and Game Engine
 * form ONE synchronized, working production system.
 * 
 * Tests:
 * 1. DATABASE & CAMPUS ZONES PERSISTENCE
 * 2. POSTGRES LEADERBOARD REPOSITORY & REAL RANKING
 * 3. HTTP API: GET /api/v1/zones (Real PostgreSQL zones)
 * 4. HTTP API: GET /api/v1/leaderboard/weekly (Real PostgreSQL profiles)
 * 5. CLAIM TO LEADERBOARD SYNC (Claim -> Profile Update -> Immediate Leaderboard Climb)
 * 6. ADMIN ROTATION & GAME SETTINGS MUTATIONS & AUDIT TRAIL
 * 7. ADMIN MANUAL WEEKLY RESET (Cycle advancement + season_points wipe + force rotate)
 * 8. API GAME SERVICE (Frontend client calling real backend APIs)
 */

import http from 'http';
import crypto from 'crypto';
import { createApp } from './server/app';
import { config } from './server/config';
import { dbPool } from './server/infrastructure/database/pool';
import { JwtUtils } from './server/infrastructure/auth/JwtUtils';
import { PostgresSpawnRepository } from './server/infrastructure/repositories/postgres/PostgresSpawnRepository';
import { PostgresBatchRepository } from './server/infrastructure/repositories/postgres/PostgresBatchRepository';
import { PostgresClaimRepository } from './server/infrastructure/repositories/postgres/PostgresClaimRepository';
import { PostgresGeospatialService } from './server/infrastructure/geo/PostgresGeospatialService';
import { PostgresZoneRepository } from './server/infrastructure/repositories/postgres/PostgresZoneRepository';
import { PostgresLeaderboardRepository } from './server/infrastructure/repositories/postgres/PostgresLeaderboardRepository';
import { SpawnPoint } from './server/domain/entities/SpawnPoint';

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
            // raw string
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

async function runSystemSyncAudit() {
  console.log('================================================================');
  console.log('🔗 PROJECT I9 — CROSS-LAYER SYSTEM SYNCHRONIZATION AUDIT');
  console.log('================================================================\n');

  dbPool.initialize({
    connectionString: config.DATABASE_URL,
    max: 20,
    min: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statementTimeoutMillis: 10000,
  });

  const zoneRepo = new PostgresZoneRepository(dbPool);
  const leaderboardRepo = new PostgresLeaderboardRepository(dbPool);
  const spawnRepo = new PostgresSpawnRepository(dbPool);
  const batchRepo = new PostgresBatchRepository(dbPool);
  const claimRepo = new PostgresClaimRepository(dbPool);
  const geoService = new PostgresGeospatialService(dbPool);

  const app = createApp({
    zoneRepo,
    leaderboardRepo,
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

  try {
    // -------------------------------------------------------------
    // SECTION 1: DATABASE & CAMPUS ZONES PERSISTENCE
    // -------------------------------------------------------------
    console.log('--- SECTION 1: DATABASE & CAMPUS ZONES PERSISTENCE ---');
    const zones = await zoneRepo.findAll();
    assert(zones.length >= 5, `PostgreSQL campus_zones contains all 5 canonical zones (got ${zones.length})`);
    
    const academicQuad = await zoneRepo.findById('zone-academic-core');
    assert(Boolean(academicQuad), 'Academic Quad & Tech Hub found in database');
    assert(academicQuad?.code === 'AQ-02', 'Academic Quad code is AQ-02');
    assert(Boolean(academicQuad?.props.svgPath), 'Academic Quad has SVG vector path');
    assert(academicQuad?.props.centerCoordinates.lat > 37, 'Academic Quad center latitude is valid');
    console.log('✓ Section 1 passed\n');

    // -------------------------------------------------------------
    // SECTION 2: POSTGRES LEADERBOARD REPOSITORY & REAL RANKING
    // -------------------------------------------------------------
    console.log('--- SECTION 2: POSTGRES LEADERBOARD REPOSITORY & REAL RANKING ---');
    // Provision 3 distinct test players with known season and total points
    const player1Id = crypto.randomUUID();
    const player2Id = crypto.randomUUID();
    const player3Id = crypto.randomUUID();
    createdUserIds.push(player1Id, player2Id, player3Id);

    for (const [id, email, username, seasonPts, totalPts] of [
      [player1Id, `sync_p1_${Date.now()}@campus.edu`, `p1_${Date.now()}`.substring(0, 15), 100, 500],
      [player2Id, `sync_p2_${Date.now()}@campus.edu`, `p2_${Date.now()}`.substring(0, 15), 300, 300],
      [player3Id, `sync_p3_${Date.now()}@campus.edu`, `p3_${Date.now()}`.substring(0, 15), 200, 800],
    ] as [string, string, string, number, number][]) {
      await dbPool.query(`INSERT INTO users (id, email, status) VALUES ($1, $2, 'active');`, [id, email]);
      await dbPool.query(
        `INSERT INTO profiles (user_id, username, display_name, season_points, total_points, claims_count)
         VALUES ($1, $2, $2, $3, $4, 1);`,
        [id, username, seasonPts, totalPts]
      );
    }

    const weeklyLb = await leaderboardRepo.getWeekly(10);
    assert(weeklyLb.length >= 3, 'Weekly leaderboard returns records');
    // In weekly points: Player 2 (300) > Player 3 (200) > Player 1 (100)
    const p2Rank = weeklyLb.find(r => r.playerId === player2Id);
    const p3Rank = weeklyLb.find(r => r.playerId === player3Id);
    const p1Rank = weeklyLb.find(r => r.playerId === player1Id);
    assert(Boolean(p2Rank && p3Rank && p1Rank), 'All 3 test players present in weekly leaderboard');
    assert(p2Rank!.rank < p3Rank!.rank, `Player 2 (${p2Rank?.points} pts, rank ${p2Rank?.rank}) ranks above Player 3 (${p3Rank?.points} pts, rank ${p3Rank?.rank})`);
    assert(p3Rank!.rank < p1Rank!.rank, `Player 3 ranks above Player 1 (${p1Rank?.points} pts, rank ${p1Rank?.rank})`);

    const allTimeLb = await leaderboardRepo.getAllTime(10);
    // In all-time points: Player 3 (800) > Player 1 (500) > Player 2 (300)
    const p3All = allTimeLb.find(r => r.playerId === player3Id);
    const p1All = allTimeLb.find(r => r.playerId === player1Id);
    const p2All = allTimeLb.find(r => r.playerId === player2Id);
    assert(p3All!.rank < p1All!.rank, `Player 3 (${p3All?.points} pts) ranks above Player 1 in all-time board`);
    assert(p1All!.rank < p2All!.rank, `Player 1 (${p1All?.points} pts) ranks above Player 2 in all-time board`);
    console.log('✓ Section 2 passed\n');

    // -------------------------------------------------------------
    // SECTION 3: HTTP API: GET /api/v1/zones
    // -------------------------------------------------------------
    console.log('--- SECTION 3: HTTP API: GET /api/v1/zones ---');
    const zonesRes = await requestJson(`${baseUrl}/api/v1/zones`);
    assert(zonesRes.status === 200, 'GET /api/v1/zones returns 200 OK');
    assert(zonesRes.body?.success === true, 'Response body success is true');
    assert(Array.isArray(zonesRes.body?.data) && zonesRes.body.data.length >= 5, 'Response returns 5 campus zones');
    const nhe = zonesRes.body.data.find((z: any) => z.code === 'NHE-01');
    assert(Boolean(nhe), 'North Hostel Enclave present in API response');
    assert(Boolean(nhe.centerLat) && Boolean(nhe.centerLng), 'Zone includes flat centerLat and centerLng for frontend');
    console.log('✓ Section 3 passed\n');

    // -------------------------------------------------------------
    // SECTION 4: HTTP API: GET /api/v1/leaderboard/weekly
    // -------------------------------------------------------------
    console.log('--- SECTION 4: HTTP API: GET /api/v1/leaderboard/weekly ---');
    const lbRes = await requestJson(`${baseUrl}/api/v1/leaderboard/weekly`);
    assert(lbRes.status === 200, 'GET /api/v1/leaderboard/weekly returns 200 OK');
    assert(Array.isArray(lbRes.body?.data) && lbRes.body.data.length >= 3, 'Weekly leaderboard API returns real ranked players');
    console.log('✓ Section 4 passed\n');

    // -------------------------------------------------------------
    // SECTION 5: CLAIM TO LEADERBOARD SYNC
    // -------------------------------------------------------------
    console.log('--- SECTION 5: CLAIM TO LEADERBOARD SYNC ---');
    // Set up active cycle & batch
    const cycleId = crypto.randomUUID();
    createdCycleIds.push(cycleId);
    const cycleNum = Math.floor(Date.now() / 1000) % 2000000000;
    await dbPool.query(
      `INSERT INTO weekly_cycles (id, cycle_number, starts_at, ends_at, status)
       VALUES ($1, $2, NOW() - INTERVAL '1 day', NOW() + INTERVAL '6 days', 'active');`,
      [cycleId, cycleNum]
    );

    const batchId = crypto.randomUUID();
    createdBatchIds.push(batchId);
    await dbPool.query(
      `INSERT INTO spawn_batches (id, batch_number, cycle_id, started_at, expires_at, status, is_active)
       VALUES ($1, $2, $3, NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '40 minutes', 'ACTIVE', true);`,
      [batchId, cycleNum + 100, cycleId]
    );

    const spawnId = crypto.randomUUID();
    createdSpawnIds.push(spawnId);
    const spawn = SpawnPoint.create({
      id: spawnId,
      code: `SYNC_${Date.now().toString().slice(-4)}`,
      title: 'Sync Landmark Point',
      batchId,
      coordinates: { lat: 37.4284, lng: -122.1700 },
      svgCoordinates: { x: 675, y: 740 },
      points: 250, // 250 points will propel Player 1 from 100 to 350 pts (surpassing Player 2!)
      tier: 'tier2',
      status: 'active',
      claimRadiusMeters: 30.0,
      enabled: true,
    });
    await spawnRepo.create(spawn);

    const p1Token = JwtUtils.sign(
      { sub: player1Id, email: `sync_p1@campus.edu`, username: 'p1', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );

    // Player 1 claims the 250-point spawn
    const claimRes = await requestJson(`${baseUrl}/api/v1/claims`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p1Token}` },
      body: {
        spawnId,
        latitude: 37.42841,
        longitude: -122.17001,
      },
    });

    assert(claimRes.status === 200, 'Claim executed successfully (200 OK)');
    assert(claimRes.body?.data?.pointsAwarded === 250, 'Authoritative 250 points awarded');
    assert(claimRes.body?.data?.weeklyPoints === 350, 'Profile weekly points updated to 350');

    // Immediately re-query weekly leaderboard via API
    const updatedLbRes = await requestJson(`${baseUrl}/api/v1/leaderboard/weekly`);
    assert(updatedLbRes.status === 200, 'Leaderboard re-queried successfully');
    const newP1 = updatedLbRes.body.data.find((r: any) => r.playerId === player1Id);
    const newP2 = updatedLbRes.body.data.find((r: any) => r.playerId === player2Id);
    assert(newP1!.points === 350, `Leaderboard immediately reflects 350 points for Player 1`);
    assert(newP1!.rank < newP2!.rank, `Player 1 climbed to rank ${newP1?.rank}, surpassing Player 2 (rank ${newP2?.rank})!`);
    console.log('✓ Section 5 passed\n');

    // -------------------------------------------------------------
    // SECTION 6: ADMIN ROTATION & GAME SETTINGS MUTATIONS
    // -------------------------------------------------------------
    console.log('--- SECTION 6: ADMIN ROTATION & GAME SETTINGS MUTATIONS ---');
    const adminUserId = crypto.randomUUID();
    createdUserIds.push(adminUserId);
    await dbPool.query(`INSERT INTO users (id, email, status) VALUES ($1, 'admin@campus.edu', 'active');`, [adminUserId]);
    await dbPool.query(`INSERT INTO admins (user_id, role) VALUES ($1, 'admin');`, [adminUserId]);

    const adminToken = JwtUtils.sign(
      { sub: adminUserId, email: 'admin@campus.edu', username: 'admin', role: 'ADMIN' },
      config.JWT_SECRET,
      3600
    );

    // Get rotation config
    const rotCfgRes = await requestJson(`${baseUrl}/api/v1/admin/rotation/config`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(rotCfgRes.status === 200, 'GET /api/v1/admin/rotation/config returns 200 OK');
    assert(typeof rotCfgRes.body?.data?.intervalMinutes === 'number', 'Returns real intervalMinutes');

    // Update rotation config
    const updateRotRes = await requestJson(`${baseUrl}/api/v1/admin/rotation/config`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { intervalMinutes: 30, concurrentActivePoints: 12 },
    });
    assert(updateRotRes.status === 200, 'PUT /api/v1/admin/rotation/config returns 200 OK');

    // Verify persisted in game_settings table
    const checkDbSetting = (
      await dbPool.query<any>(`SELECT value FROM game_settings WHERE key = 'engine.rotation_interval_minutes';`)
    ).rows[0];
    const val = typeof checkDbSetting.value === 'string' ? JSON.parse(checkDbSetting.value) : checkDbSetting.value;
    assert((val?.value ?? val) === 30, 'Persisted 30 min interval verified in PostgreSQL game_settings');

    // Update game settings
    const updateSettingsRes = await requestJson(`${baseUrl}/api/v1/admin/settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { 'engine.claim_radius_meters': 28 },
    });
    assert(updateSettingsRes.status === 200, 'PUT /api/v1/admin/settings returns 200 OK');

    // Verify audit log recorded
    const auditLogs = await dbPool.query<any>(
      `SELECT * FROM audit_logs WHERE admin_id = $1 ORDER BY created_at DESC;`,
      [adminUserId]
    );
    assert(auditLogs.rowCount > 0, 'Administrative mutations logged to PostgreSQL audit_logs');
    console.log('✓ Section 6 passed\n');

    // -------------------------------------------------------------
    // SECTION 7: ADMIN MANUAL WEEKLY RESET
    // -------------------------------------------------------------
    console.log('--- SECTION 7: ADMIN MANUAL WEEKLY RESET ---');
    const resetRes = await requestJson(`${baseUrl}/api/v1/admin/cycles/reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(resetRes.status === 200, 'POST /api/v1/admin/cycles/reset returns 200 OK');
    assert(resetRes.body?.success === true, 'Reset success is true');
    assert(resetRes.body?.playersResetCount >= 3, `Reset affected all test players (reset: ${resetRes.body?.playersResetCount})`);
    assert(Boolean(resetRes.body?.newCycleId), 'New cycle created');

    // Verify all players have season_points = 0
    const checkResetProfiles = await dbPool.query<any>(
      `SELECT season_points, total_points FROM profiles WHERE user_id = $1;`,
      [player1Id]
    );
    assert(checkResetProfiles.rows[0].season_points === 0, 'Player season_points wiped to 0');
    assert(checkResetProfiles.rows[0].total_points >= 500, 'Player total_points (all-time) preserved untouched');

    // Verify previous cycle completed
    const oldCycleCheck = await dbPool.query<any>(`SELECT status FROM weekly_cycles WHERE id = $1;`, [cycleId]);
    assert(oldCycleCheck.rows[0].status === 'completed', 'Previous weekly cycle marked completed');
    console.log('✓ Section 7 passed\n');

    // -------------------------------------------------------------
    // SECTION 8: DEV LOGIN & AUTHENTICATION BRIDGE
    // -------------------------------------------------------------
    console.log('--- SECTION 8: DEV LOGIN & AUTHENTICATION BRIDGE ---');
    const devLoginRes = await requestJson(`${baseUrl}/api/v1/auth/dev-login`, {
      method: 'POST',
      body: { role: 'STUDENT', email: 'runner@campus.edu' },
    });
    assert(devLoginRes.status === 200, 'POST /api/v1/auth/dev-login returns 200 OK');
    assert(Boolean(devLoginRes.body?.accessToken), 'Returns valid JWT accessToken');
    assert(devLoginRes.body?.user?.role === 'STUDENT', 'User role is STUDENT');

    const devAdminLoginRes = await requestJson(`${baseUrl}/api/v1/auth/dev-login`, {
      method: 'POST',
      body: { role: 'ADMIN', email: 'headadmin@campus.edu' },
    });
    assert(devAdminLoginRes.status === 200, 'POST /api/v1/auth/dev-login for admin returns 200 OK');
    assert(devAdminLoginRes.body?.user?.role === 'ADMIN', 'Admin user role is ADMIN');
    console.log('✓ Section 8 passed\n');

    console.log('****************************************************************');
    console.log('🎉 ALL 8 CROSS-LAYER SYSTEM SYNCHRONIZATION AUDITS PASSED 100%!');
    console.log('****************************************************************\n');
  } finally {
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
        await dbPool.query(`DELETE FROM audit_logs WHERE admin_id = ANY($1::uuid[]);`, [createdUserIds]);
        await dbPool.query(`DELETE FROM admins WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
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

runSystemSyncAudit().catch((err) => {
  console.error('FATAL SYSTEM SYNC AUDIT ERROR:', err);
  process.exit(1);
});
