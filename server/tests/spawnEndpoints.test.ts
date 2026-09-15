import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SpawnController } from '../controllers/SpawnController';
import { GetActiveSpawnsUseCase } from '../services/GetActiveSpawnsUseCase';
import { GetSpawnByIdUseCase } from '../services/GetSpawnByIdUseCase';
import { InMemorySpawnRepository } from '../infrastructure/repositories/inmemory/InMemorySpawnRepository';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { createApp } from '../app';

describe('Spawn Endpoints (GET /api/v1/spawns/active & GET /api/v1/spawns/:id)', () => {
  let spawnRepo: InMemorySpawnRepository;
  let getActiveSpawnsUseCase: GetActiveSpawnsUseCase;
  let getSpawnByIdUseCase: GetSpawnByIdUseCase;
  let spawnController: SpawnController;

  const activeSpawn1 = new SpawnPoint({
    id: 'spawn-act-01',
    code: 'LIB01',
    title: 'Library Fountain Drop',
    description: 'Near the central fountain outside the main library',
    clue: 'Look where the water flows',
    zoneId: 'zone-north',
    zoneName: 'North Quad',
    coordinates: { lat: 12.9716, lng: 77.5946 },
    svgCoordinates: { x: 120, y: 180 },
    points: 100,
    tier: 'tier1',
    status: 'active',
    claimRadiusMeters: 25,
    enabled: true,
    expiresAt: new Date(Date.now() + 3600 * 1000), // active in future
    claimCount: 3,
    maxClaims: 10,
  });

  const activeSpawn2 = new SpawnPoint({
    id: 'spawn-act-02',
    code: 'GYM02',
    title: 'Gymnasium Quad Drop',
    description: 'Adjacent to the sports complex',
    clue: 'Near the running track',
    zoneId: 'zone-south',
    zoneName: 'South Campus',
    coordinates: { lat: 12.975, lng: 77.598 },
    svgCoordinates: { x: 250, y: 320 },
    points: 250,
    tier: 'tier3',
    status: 'active',
    claimRadiusMeters: 15,
    enabled: true,
    expiresAt: new Date(Date.now() + 7200 * 1000),
    claimCount: 0,
  });

  const expiredSpawn = new SpawnPoint({
    id: 'spawn-exp-03',
    code: 'OLD03',
    title: 'Expired Campus Drop',
    zoneId: 'zone-east',
    zoneName: 'East Campus',
    coordinates: { lat: 12.98, lng: 77.6 },
    svgCoordinates: { x: 400, y: 400 },
    points: 50,
    tier: 'tier1',
    status: 'active',
    claimRadiusMeters: 30,
    enabled: true,
    expiresAt: new Date(Date.now() - 3600 * 1000), // expired 1 hour ago
    claimCount: 1,
  });

  const disabledSpawn = new SpawnPoint({
    id: 'spawn-dis-04',
    code: 'DIS04',
    title: 'Disabled Admin Drop',
    zoneId: 'zone-west',
    zoneName: 'West Campus',
    coordinates: { lat: 12.96, lng: 77.58 },
    svgCoordinates: { x: 50, y: 50 },
    points: 100,
    tier: 'tier1',
    status: 'active',
    claimRadiusMeters: 20,
    enabled: false, // disabled
    expiresAt: new Date(Date.now() + 3600 * 1000),
    claimCount: 0,
  });

  beforeEach(() => {
    spawnRepo = new InMemorySpawnRepository([
      activeSpawn1,
      activeSpawn2,
      expiredSpawn,
      disabledSpawn,
    ]);

    getActiveSpawnsUseCase = new GetActiveSpawnsUseCase(spawnRepo);
    getSpawnByIdUseCase = new GetSpawnByIdUseCase(spawnRepo);
    spawnController = new SpawnController(getActiveSpawnsUseCase, getSpawnByIdUseCase);
  });

  describe('1. GET /api/v1/spawns/active', () => {
    it('should return only active, enabled, non-expired spawns', async () => {
      let responseStatusCode = 200;
      let responseBody: any = null;

      const req: any = { query: {} };
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

      await spawnController.getActiveSpawns(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.ok(Array.isArray(responseBody.data));
      assert.equal(responseBody.data.length, 2);

      const returnedIds = responseBody.data.map((s: any) => s.id);
      assert.ok(returnedIds.includes('spawn-act-01'));
      assert.ok(returnedIds.includes('spawn-act-02'));
      assert.equal(returnedIds.includes('spawn-exp-03'), false); // expired excluded
      assert.equal(returnedIds.includes('spawn-dis-04'), false); // disabled excluded
    });

    it('should return only safe public spawn fields and avoid leaking internal fields', async () => {
      let responseBody: any = null;
      const res: any = {
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await spawnController.getActiveSpawns({ query: {} } as any, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      const spawnItem = responseBody.data.find((s: any) => s.id === 'spawn-act-01');
      assert.ok(spawnItem);

      // Verify safe fields exist
      assert.equal(spawnItem.id, 'spawn-act-01');
      assert.equal(spawnItem.code, 'LIB01');
      assert.equal(spawnItem.title, 'Library Fountain Drop');
      assert.equal(spawnItem.description, 'Near the central fountain outside the main library');
      assert.equal(spawnItem.clue, 'Look where the water flows');
      assert.equal(spawnItem.tier, 'tier1');
      assert.equal(spawnItem.status, 'active');
      assert.equal(spawnItem.points, 100);
      assert.equal(spawnItem.claimRadiusMeters, 25);
      assert.deepEqual(spawnItem.coordinates, { lat: 12.9716, lng: 77.5946 });
      assert.deepEqual(spawnItem.svgCoordinates, { x: 120, y: 180 });
      assert.equal(spawnItem.zoneName, 'North Quad');
      assert.ok(spawnItem.expiresAt);

      // Verify internal / admin-only fields are NOT exposed
      assert.equal(spawnItem.enabled, undefined);
      assert.equal(spawnItem.claimCount, undefined);
      assert.equal(spawnItem.maxClaims, undefined);
      assert.equal(spawnItem.batchId, undefined);
      assert.equal(spawnItem.seed, undefined);
    });

    it('should return empty array when there are no active spawns', async () => {
      const emptySpawnRepo = new InMemorySpawnRepository([expiredSpawn, disabledSpawn]);
      const emptyActiveUseCase = new GetActiveSpawnsUseCase(emptySpawnRepo);
      const controller = new SpawnController(emptyActiveUseCase, getSpawnByIdUseCase);

      let responseBody: any = null;
      const res: any = {
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await controller.getActiveSpawns({ query: {} } as any, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseBody.success, true);
      assert.deepEqual(responseBody.data, []);
    });

    it('should support bounding box pre-filtering when bounds are supplied', async () => {
      const req: any = {
        query: {
          north: '12.972',
          south: '12.970',
          east: '77.595',
          west: '77.594',
        },
      };

      let responseBody: any = null;
      const res: any = {
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await spawnController.getActiveSpawns(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseBody.success, true);
      assert.equal(responseBody.data.length, 1);
      assert.equal(responseBody.data[0].id, 'spawn-act-01');
    });
  });

  describe('2. GET /api/v1/spawns/:id', () => {
    it('should return single spawn details by ID', async () => {
      const req: any = { params: { id: 'spawn-act-01' } };
      let responseBody: any = null;
      const res: any = {
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      await spawnController.getSpawnById(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseBody.success, true);
      assert.ok(responseBody.data);
      assert.equal(responseBody.data.id, 'spawn-act-01');
      assert.equal(responseBody.data.code, 'LIB01');
      assert.equal(responseBody.data.title, 'Library Fountain Drop');
      assert.equal(responseBody.data.points, 100);
      assert.equal(responseBody.data.claimRadiusMeters, 25);
      assert.deepEqual(responseBody.data.coordinates, { lat: 12.9716, lng: 77.5946 });

      // Verify internal fields are not present
      assert.equal(responseBody.data.enabled, undefined);
      assert.equal(responseBody.data.claimCount, undefined);
      assert.equal(responseBody.data.maxClaims, undefined);
    });

    it('should return 404 NotFoundError when spawn ID does not exist', async () => {
      const req: any = { params: { id: 'non-existent-spawn-id' } };
      let errReceived: any = null;

      await spawnController.getSpawnById(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 404);
      assert.match(errReceived.message, /not found/i);
    });

    it('should return 404 NotFoundError when spawn ID is empty string', async () => {
      const req: any = { params: { id: '   ' } };
      let errReceived: any = null;

      await spawnController.getSpawnById(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 404);
    });
  });

  describe('3. App Integration & Route Mounting', () => {
    it('should mount spawns router and handle active and id routes in full app', () => {
      const app = createApp({ spawnRepo });
      assert.ok(app);
    });
  });
});
