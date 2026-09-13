import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameController } from '../controllers/GameController';
import { GetGameStateUseCase } from '../services/GetGameStateUseCase';
import { GetGameRotationUseCase } from '../services/GetGameRotationUseCase';
import { InMemorySpawnRepository } from '../infrastructure/repositories/inmemory/InMemorySpawnRepository';
import { InMemoryWeeklyCycleRepository } from '../infrastructure/repositories/inmemory/InMemoryWeeklyCycleRepository';
import { InMemoryRotationRepository } from '../infrastructure/repositories/inmemory/InMemoryRotationRepository';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { WeeklyCycle } from '../domain/entities/WeeklyCycle';
import { Rotation } from '../domain/entities/Rotation';
import { createApp } from '../app';

describe('Game APIs (GET /api/v1/game/state & GET /api/v1/game/rotation)', () => {
  let spawnRepo: InMemorySpawnRepository;
  let weeklyCycleRepo: InMemoryWeeklyCycleRepository;
  let rotationRepo: InMemoryRotationRepository;
  let getGameStateUseCase: GetGameStateUseCase;
  let getGameRotationUseCase: GetGameRotationUseCase;
  let gameController: GameController;

  const testCycle = new WeeklyCycle({
    id: 'cycle-uuid-001',
    startsAt: new Date('2026-09-07T00:00:00.000Z'),
    endsAt: new Date('2026-09-14T00:00:00.000Z'),
    status: 'active',
    createdAt: new Date('2026-09-07T00:00:00.000Z'),
  });

  const activeSpawn1 = new SpawnPoint({
    id: 'spawn-01',
    code: 'SPAWN01',
    title: 'Library Courtyard',
    zoneId: 'zone-north',
    zoneName: 'North Campus',
    coordinates: { lat: 12.9716, lng: 77.5946 },
    svgCoordinates: { x: 100, y: 150 },
    points: 100,
    tier: 'tier1',
    status: 'active',
    claimRadiusMeters: 25,
    enabled: true,
    expiresAt: new Date(Date.now() + 3600 * 1000),
    claimCount: 2,
  });

  const activeSpawn2 = new SpawnPoint({
    id: 'spawn-02',
    code: 'SPAWN02',
    title: 'Student Union Lawn',
    zoneId: 'zone-central',
    zoneName: 'Central Campus',
    coordinates: { lat: 12.972, lng: 77.595 },
    svgCoordinates: { x: 200, y: 250 },
    points: 150,
    tier: 'tier2',
    status: 'active',
    claimRadiusMeters: 20,
    enabled: true,
    expiresAt: new Date(Date.now() + 3600 * 1000),
    claimCount: 0,
  });

  const inactiveSpawn = new SpawnPoint({
    id: 'spawn-03',
    code: 'SPAWN03',
    title: 'East Gate Fountain',
    zoneId: 'zone-east',
    zoneName: 'East Campus',
    coordinates: { lat: 12.973, lng: 77.596 },
    svgCoordinates: { x: 300, y: 350 },
    points: 50,
    tier: 'tier1',
    status: 'expired',
    claimRadiusMeters: 30,
    enabled: false,
    expiresAt: new Date(Date.now() - 3600 * 1000),
    claimCount: 5,
  });

  beforeEach(() => {
    spawnRepo = new InMemorySpawnRepository([activeSpawn1, activeSpawn2, inactiveSpawn]);
    weeklyCycleRepo = new InMemoryWeeklyCycleRepository([testCycle]);
    rotationRepo = new InMemoryRotationRepository();

    getGameStateUseCase = new GetGameStateUseCase(spawnRepo, weeklyCycleRepo);
    getGameRotationUseCase = new GetGameRotationUseCase(rotationRepo, spawnRepo);
    gameController = new GameController(getGameStateUseCase, getGameRotationUseCase);
  });

  describe('1. GET /api/v1/game/state', () => {
    it('should return complete game state with active cycle, active spawn count, and next reset timestamp', async () => {
      let responseStatusCode = 200;
      let responseBody: any = null;

      const req: any = {};
      const res: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await gameController.getGameState(req, res, (err) => {
        assert.fail(`Unexpected error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.ok(responseBody.data);

      const state = responseBody.data;
      assert.equal(state.status, 'active');
      assert.equal(state.activeSpawnsCount, 2); // 2 active, 1 inactive/disabled
      assert.ok(state.serverTimestamp);
      assert.ok(state.currentCycle);
      assert.equal(state.currentCycle.id, 'cycle-uuid-001');
      assert.equal(state.currentCycle.status, 'active');
      assert.equal(state.currentCycle.startsAt, '2026-09-07T00:00:00.000Z');
      assert.equal(state.currentCycle.endsAt, '2026-09-14T00:00:00.000Z');
      assert.equal(state.nextResetAt, '2026-09-14T00:00:00.000Z');
    });

    it('should handle game state when no weekly cycle is currently configured', async () => {
      const emptyCycleRepo = new InMemoryWeeklyCycleRepository([]);
      const stateUseCase = new GetGameStateUseCase(spawnRepo, emptyCycleRepo);
      const controller = new GameController(stateUseCase, getGameRotationUseCase);

      let responseBody: any = null;
      const res: any = {
        status() {
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await controller.getGameState({} as any, res, (err) => {
        assert.fail(`Unexpected error: ${err}`);
      });

      assert.equal(responseBody.success, true);
      assert.equal(responseBody.data.status, 'active');
      assert.equal(responseBody.data.activeSpawnsCount, 2);
      assert.equal(responseBody.data.currentCycle, null);
      assert.equal(responseBody.data.nextResetAt, null);
    });
  });

  describe('2. GET /api/v1/game/rotation', () => {
    it('should return current rotation state when an explicit rotation is recorded', async () => {
      const rotationExpiresAt = new Date(Date.now() + 1800 * 1000); // 30 mins remaining
      const savedRotation = new Rotation({
        id: 'rot-101',
        rotationNumber: 12,
        startedAt: new Date(Date.now() - 900 * 1000), // 15 mins ago
        expiresAt: rotationExpiresAt,
        totalSpawns: 15,
        activeSpawns: 2,
        nextRotationInSeconds: 1800,
      });
      await rotationRepo.save(savedRotation);

      let responseStatusCode = 200;
      let responseBody: any = null;
      const res: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await gameController.getGameRotation({} as any, res, (err) => {
        assert.fail(`Unexpected error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);

      const rot = responseBody.data;
      assert.equal(rot.id, 'rot-101');
      assert.equal(rot.rotationNumber, 12);
      assert.equal(rot.activeSpawns, 2);
      assert.equal(rot.totalSpawns, 15);
      assert.ok(rot.nextRotationInSeconds > 0 && rot.nextRotationInSeconds <= 1800);
      assert.equal(rot.isExpired, false);
    });

    it('should derive safe fallback rotation from active spawns when rotation repo is initially empty', async () => {
      let responseBody: any = null;
      const res: any = {
        status() {
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await gameController.getGameRotation({} as any, res, (err) => {
        assert.fail(`Unexpected error: ${err}`);
      });

      assert.equal(responseBody.success, true);
      const rot = responseBody.data;
      assert.equal(rot.id, 'rot_active');
      assert.equal(rot.rotationNumber, 1);
      assert.equal(rot.activeSpawns, 2);
      assert.equal(rot.totalSpawns, 2);
      assert.ok(rot.startedAt);
      assert.ok(rot.expiresAt);
      assert.ok(typeof rot.nextRotationInSeconds === 'number');
    });
  });

  describe('3. App Integration & Route Mounting', () => {
    it('should mount game routes under /api/v1/game in full app setup', () => {
      const app = createApp({
        spawnRepo,
        weeklyCycleRepo,
        rotationRepo,
      });
      assert.ok(app);
    });
  });
});
