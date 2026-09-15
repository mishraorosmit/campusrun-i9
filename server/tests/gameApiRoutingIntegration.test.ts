import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { InMemorySpawnRepository } from '../infrastructure/repositories/inmemory/InMemorySpawnRepository';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { InMemoryClaimRepository } from '../infrastructure/repositories/inmemory/InMemoryClaimRepository';
import { InMemoryLeaderboardRepository } from '../infrastructure/repositories/inmemory/InMemoryLeaderboardRepository';
import { InMemoryWeeklyCycleRepository } from '../infrastructure/repositories/inmemory/InMemoryWeeklyCycleRepository';
import { InMemoryRotationRepository } from '../infrastructure/repositories/inmemory/InMemoryRotationRepository';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { Player } from '../domain/entities/Player';
import { WeeklyCycle } from '../domain/entities/WeeklyCycle';
import { JwtUtils } from '../infrastructure/auth/JwtUtils';
import { config } from '../config';

describe('Game APIs Route Wiring & End-to-End Integration', () => {
  let server: http.Server;
  let baseUrl: string;
  let spawnRepo: InMemorySpawnRepository;
  let playerRepo: InMemoryPlayerRepository;
  let claimRepo: InMemoryClaimRepository;
  let leaderboardRepo: InMemoryLeaderboardRepository;
  let weeklyCycleRepo: InMemoryWeeklyCycleRepository;
  let rotationRepo: InMemoryRotationRepository;

  let player1Token: string;
  let player2Token: string;

  before(async () => {
    spawnRepo = new InMemorySpawnRepository();
    playerRepo = new InMemoryPlayerRepository();
    claimRepo = new InMemoryClaimRepository();
    // 1. Seed Weekly Cycle
    const cycle = new WeeklyCycle({
      id: 'cycle-2026-w37',
      startsAt: new Date(Date.now() - 24 * 3600 * 1000),
      endsAt: new Date(Date.now() + 6 * 24 * 3600 * 1000),
      status: 'active',
      createdAt: new Date(Date.now() - 24 * 3600 * 1000),
    });
    weeklyCycleRepo = new InMemoryWeeklyCycleRepository([cycle]);
    rotationRepo = new InMemoryRotationRepository();

    // 2. Seed Players
    const player1 = new Player({
      id: 'player_001',
      email: 'alex@campus.edu',
      username: 'alex_runner',
      displayName: 'Alex Runner',
      totalPoints: 1200,
      seasonPoints: 450,
      rank: 1,
      tier: 'tier1',
      claimsCount: 5,
      currentStreakDays: 2,
      role: 'STUDENT',
      avatarUrl: 'https://avatar.com/alex.png',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });
    const player2 = new Player({
      id: 'player_002',
      email: 'sam@campus.edu',
      username: 'sam_sprinter',
      displayName: 'Sam Sprinter',
      totalPoints: 1500,
      seasonPoints: 300,
      rank: 2,
      tier: 'tier2',
      claimsCount: 3,
      currentStreakDays: 1,
      role: 'STUDENT',
      avatarUrl: 'https://avatar.com/sam.png',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });
    await playerRepo.save(player1);
    await playerRepo.save(player2);

    // Seed Leaderboard entries
    leaderboardRepo = new InMemoryLeaderboardRepository([
      {
        rank: 0,
        profile_id: 'player_001',
        playerId: 'player_001',
        username: 'alex_runner',
        displayName: 'Alex Runner',
        avatarUrl: 'https://avatar.com/alex.png',
        points: 450,
        claimsCount: 5,
        tier: 'tier1',
        rankChange: 'same',
      },
      {
        rank: 0,
        profile_id: 'player_002',
        playerId: 'player_002',
        username: 'sam_sprinter',
        displayName: 'Sam Sprinter',
        avatarUrl: 'https://avatar.com/sam.png',
        points: 300,
        claimsCount: 3,
        tier: 'tier2',
        rankChange: 'same',
      },
    ]);

    // 3. Seed Spawns
    const activeSpawn = new SpawnPoint({
      id: 'spawn_lib_01',
      code: 'LIB01',
      title: 'Main Library Lawn',
      description: 'North side near library stairs',
      clue: 'Look near the entrance steps',
      zoneId: 'zone-north',
      zoneName: 'North Campus',
      coordinates: { lat: 12.9716, lng: 77.5946 },
      svgCoordinates: { x: 100, y: 150 },
      points: 100,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25,
      enabled: true,
      expiresAt: new Date(Date.now() + 7200 * 1000),
      claimCount: 0,
    });
    const expiredSpawn = new SpawnPoint({
      id: 'spawn_exp_02',
      code: 'EXP02',
      title: 'Old Clock Tower',
      zoneId: 'zone-east',
      zoneName: 'East Campus',
      coordinates: { lat: 12.975, lng: 77.598 },
      svgCoordinates: { x: 200, y: 250 },
      points: 50,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 20,
      enabled: true,
      expiresAt: new Date(Date.now() - 3600 * 1000), // expired
      claimCount: 0,
    });
    await spawnRepo.save(activeSpawn);
    await spawnRepo.save(expiredSpawn);

    // 4. Generate Auth Tokens
    player1Token = JwtUtils.sign(
      { sub: 'player_001', email: 'alex@campus.edu', username: 'alex_runner', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );
    player2Token = JwtUtils.sign(
      { sub: 'player_002', email: 'sam@campus.edu', username: 'sam_sprinter', role: 'STUDENT' },
      config.JWT_SECRET,
      3600
    );

    // 5. Instantiate App and start ephemeral HTTP server
    const app = createApp({
      spawnRepo,
      playerRepo,
      claimRepo,
      leaderboardRepo,
      weeklyCycleRepo,
      rotationRepo,
    });

    server = app.listen(0);
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  describe('1. GET /api/v1/game/state', () => {
    it('should return game state with active cycle info and spawn counts', async () => {
      const res = await fetch(`${baseUrl}/api/v1/game/state`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.status, 'active');
      assert.equal(json.data.activeSpawnsCount, 1);
      assert.ok(json.data.currentCycle);
      assert.equal(json.data.currentCycle.id, 'cycle-2026-w37');
      assert.equal(json.data.currentCycle.status, 'active');
      assert.ok(json.data.serverTimestamp);
      assert.ok(json.data.nextResetAt);
    });
  });

  describe('2. GET /api/v1/game/rotation', () => {
    it('should return rotation state without mutating database', async () => {
      const res = await fetch(`${baseUrl}/api/v1/game/rotation`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.data.id);
      assert.equal(json.data.activeSpawns, 1);
      assert.equal(json.data.isExpired, false);
      assert.ok(typeof json.data.nextRotationInSeconds === 'number');
    });
  });

  describe('3. GET /api/v1/spawns/active', () => {
    it('should return only active, non-expired spawns', async () => {
      const res = await fetch(`${baseUrl}/api/v1/spawns/active`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(Array.isArray(json.data), true);
      assert.equal(json.data.length, 1);
      assert.equal(json.data[0].id, 'spawn_lib_01');
      assert.equal(json.data[0].title, 'Main Library Lawn');
    });

    it('should reject invalid query bounds parameters with 400', async () => {
      const res = await fetch(`${baseUrl}/api/v1/spawns/active?north=invalid_lat`);
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.equal(json.success, false);
    });
  });

  describe('4. GET /api/v1/spawns/:id', () => {
    it('should return safe public fields for existing spawn', async () => {
      const res = await fetch(`${baseUrl}/api/v1/spawns/spawn_lib_01`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.id, 'spawn_lib_01');
      assert.equal(json.data.code, 'LIB01');
      assert.equal(json.data.points, 100);
      assert.equal(json.data.status, 'active');
      assert.equal(json.data.enabled, undefined); // internal field omitted
    });

    it('should return 404 for non-existent spawn id', async () => {
      const res = await fetch(`${baseUrl}/api/v1/spawns/non_existent_spawn_999`);
      assert.equal(res.status, 404);

      const json = await res.json();
      assert.equal(json.success, false);
    });
  });

  describe('5. POST /api/v1/claims', () => {
    it('should return 401 Unauthorized when unauthenticated', async () => {
      const res = await fetch(`${baseUrl}/api/v1/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spawnId: 'spawn_lib_01' }),
      });
      assert.equal(res.status, 401);

      const json = await res.json();
      assert.equal(json.success, false);
    });

    it('should return 400 Bad Request when spawnId is missing or empty', async () => {
      const res = await fetch(`${baseUrl}/api/v1/claims`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${player1Token}`,
        },
        body: JSON.stringify({ spawnId: '' }),
      });
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.equal(json.success, false);
    });

    it('should successfully create claim with 201 Created for authenticated player', async () => {
      const res = await fetch(`${baseUrl}/api/v1/claims`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${player1Token}`,
        },
        body: JSON.stringify({
          spawnId: 'spawn_lib_01',
          lat: 12.9716,
          lng: 77.5946,
        }),
      });
      assert.equal(res.status, 201);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.success, true);
      assert.equal(json.data.pointsAwarded, 100);
      assert.equal(json.data.spawnId, 'spawn_lib_01');
      assert.ok(json.data.claimId);
    });

    it('should return 409 Conflict when player attempts duplicate claim on same spawn', async () => {
      const res = await fetch(`${baseUrl}/api/v1/claims`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${player1Token}`,
        },
        body: JSON.stringify({ spawnId: 'spawn_lib_01' }),
      });
      assert.equal(res.status, 409);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'ALREADY_CLAIMED');
    });

    it('should return 404 Not Found when claiming non-existent spawn', async () => {
      const res = await fetch(`${baseUrl}/api/v1/claims`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${player2Token}`,
        },
        body: JSON.stringify({ spawnId: 'spawn_ghost_999' }),
      });
      assert.equal(res.status, 404);

      const json = await res.json();
      assert.equal(json.success, false);
    });

    it('should return 422 Unprocessable Entity when claiming expired spawn', async () => {
      const res = await fetch(`${baseUrl}/api/v1/claims`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${player2Token}`,
        },
        body: JSON.stringify({ spawnId: 'spawn_exp_02' }),
      });
      assert.equal(res.status, 422);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'SPAWN_EXPIRED');
    });
  });

  describe('6. GET /api/v1/leaderboard/weekly', () => {
    it('should return players ordered by weekly season_points descending with rank', async () => {
      const res = await fetch(`${baseUrl}/api/v1/leaderboard/weekly`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(Array.isArray(json.data), true);
      assert.ok(json.data.length >= 2);

      // Player 1 had 450 + 100 from claim = 550. Player 2 has 300.
      const topPlayer = json.data[0];
      const secondPlayer = json.data[1];

      assert.equal(topPlayer.profile_id, 'player_001');
      assert.equal(topPlayer.rank, 1);
      assert.equal(topPlayer.points, 550);
      assert.equal(topPlayer.username, 'alex_runner');

      assert.equal(secondPlayer.profile_id, 'player_002');
      assert.equal(secondPlayer.rank, 2);
      assert.equal(secondPlayer.points, 300);
      assert.equal(secondPlayer.username, 'sam_sprinter');
    });

    it('should support pagination via limit and offset query parameters', async () => {
      const res = await fetch(`${baseUrl}/api/v1/leaderboard/weekly?limit=1&offset=1`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.length, 1);
      assert.equal(json.data[0].profile_id, 'player_002');
      assert.equal(json.data[0].rank, 2);
    });
  });

  describe('7. GET /api/v1/leaderboard/all-time', () => {
    it('should return players ordered by all-time points descending with rank', async () => {
      const res = await fetch(`${baseUrl}/api/v1/leaderboard/all-time`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(Array.isArray(json.data), true);
      assert.ok(json.data.length >= 2);

      // Player 1 had 450 + 100 from claim = 550. Player 2 has 300.
      const topPlayer = json.data[0];
      const secondPlayer = json.data[1];

      assert.equal(topPlayer.profile_id, 'player_001');
      assert.equal(topPlayer.rank, 1);
      assert.equal(topPlayer.points, 550);

      assert.equal(secondPlayer.profile_id, 'player_002');
      assert.equal(secondPlayer.rank, 2);
      assert.equal(secondPlayer.points, 300);
    });

    it('should support pagination via limit and offset query parameters', async () => {
      const res = await fetch(`${baseUrl}/api/v1/leaderboard/all-time?limit=1&offset=1`);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.length, 1);
      assert.equal(json.data[0].profile_id, 'player_002');
      assert.equal(json.data[0].rank, 2);
    });
  });
});
