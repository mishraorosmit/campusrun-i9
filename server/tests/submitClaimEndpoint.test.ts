import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimController } from '../controllers/ClaimController';
import { ClaimSpawnUseCase } from '../services/ClaimSpawnUseCase';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { Player } from '../domain/entities/Player';
import { Claim } from '../domain/entities/Claim';
import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { IClaimRepository } from '../repositories/IClaimRepository';
import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';
import { ITransactionManager, ITransactionContext } from '../repositories/ITransactionManager';
import { IGeofencingService } from '../domain/rules';
import { IEventBus } from '../events/IEventBus';
import { requireCurrentUser } from '../middlewares/auth';
import { DomainError, ErrorCodes } from '../errors';

class FakeTransactionManager implements ITransactionManager {
  async runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    const dummyTx: ITransactionContext = {
      query: async <R = Record<string, unknown>>() => ({ rows: [] as R[], rowCount: 1 }),
    };
    return work(dummyTx);
  }
}

class InMemoryConcurrentClaimRepository implements IClaimRepository {
  private claimedSet = new Set<string>();
  private claims = new Map<string, Claim>();

  async countBySpawnAndPlayer(spawnId: string, playerId: string): Promise<number> {
    return this.claimedSet.has(`${playerId}:${spawnId}`) ? 1 : 0;
  }

  async saveTx(claim: Claim, _tx: ITransactionContext): Promise<boolean> {
    const key = `${claim.playerId}:${claim.spawnId}`;
    if (this.claimedSet.has(key)) {
      return false; // Atomic duplicate detection (ON CONFLICT DO NOTHING -> 0 rows affected)
    }
    this.claimedSet.add(key);
    this.claims.set(claim.id, claim);
    return true;
  }

  async findById(id: string): Promise<Claim | null> {
    return this.claims.get(id) || null;
  }

  async findByPlayerId(playerId: string): Promise<Claim[]> {
    return Array.from(this.claims.values()).filter((c) => c.playerId === playerId);
  }

  async save(claim: Claim): Promise<void> {
    this.claims.set(claim.id, claim);
  }

  async hasClaimed(spawnId: string, playerId: string): Promise<boolean> {
    return this.claimedSet.has(`${playerId}:${spawnId}`);
  }

  async findRecent(): Promise<Claim[]> {
    return Array.from(this.claims.values());
  }
}

describe('POST /api/v1/claims Endpoint and Duplicate Protection', () => {
  let player: Player;
  let activeSpawn: SpawnPoint;
  let expiredSpawn: SpawnPoint;
  let spawnRepo: ISpawnRepository;
  let playerRepo: IPlayerRepository;
  let claimRepo: InMemoryConcurrentClaimRepository;
  let leaderboardRepo: ILeaderboardRepository;
  let txManager: ITransactionManager;
  let geoCalculator: IGeofencingService;
  let eventBus: IEventBus;
  let useCase: ClaimSpawnUseCase;
  let controller: ClaimController;

  beforeEach(() => {
    player = new Player({
      id: 'player-test-01',
      email: 'runner@campus.edu',
      username: 'campus_runner',
      totalPoints: 500,
      seasonPoints: 200,
      rank: 4,
      tier: 'tier1',
      claimsCount: 5,
      currentStreakDays: 3,
      role: 'STUDENT',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      lastActiveAt: new Date('2026-09-13T00:00:00.000Z'),
    });

    activeSpawn = new SpawnPoint({
      id: 'spawn-test-01',
      code: 'LIB01',
      title: 'Main Library Lawn',
      zoneId: 'zone-north',
      zoneName: 'North Quad',
      coordinates: { lat: 12.9716, lng: 77.5946 },
      svgCoordinates: { x: 100, y: 150 },
      points: 100,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25,
      enabled: true,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      claimCount: 0,
    });

    expiredSpawn = new SpawnPoint({
      id: 'spawn-test-02',
      code: 'OLD02',
      title: 'Old Expired Drop',
      zoneId: 'zone-south',
      zoneName: 'South Campus',
      coordinates: { lat: 12.975, lng: 77.598 },
      svgCoordinates: { x: 200, y: 250 },
      points: 50,
      tier: 'tier1',
      status: 'expired',
      claimRadiusMeters: 20,
      enabled: true,
      expiresAt: new Date(Date.now() - 3600 * 1000), // expired
      claimCount: 0,
    });

    spawnRepo = {
      create: async (s: any) => s,
      update: async (s: any) => s,
      findAll: async () => [activeSpawn],
      findAvailableForBatch: async () => [activeSpawn],
      findById: async (id: string) => {
        if (id === activeSpawn.id) return activeSpawn;
        if (id === expiredSpawn.id) return expiredSpawn;
        return null;
      },
      findByCode: async () => null,
      findActive: async () => [activeSpawn],
      findWithinBounds: async () => [activeSpawn],
      findNearby: async () => [activeSpawn],
      save: async () => {},
      updateStatus: async () => {},
    };

    playerRepo = {
      findById: async (id: string) => (id === player.id ? player : null),
      updatePointsTx: async (_id: string, pts: number) => {
        player = new Player({
          ...player.props,
          totalPoints: player.props.totalPoints + pts,
          seasonPoints: player.props.seasonPoints + pts,
          claimsCount: player.props.claimsCount + 1,
        });
      },
      findByEmail: async () => null,
      findByUsername: async () => null,
      save: async () => {},
      updatePoints: async () => {},
      incrementStreak: async () => {},
    };

    claimRepo = new InMemoryConcurrentClaimRepository();

    leaderboardRepo = {
      recordScore: async () => {},
      getWeekly: async () => [],
      getAllTime: async () => [],
      getPlayerWeeklyRank: async () => null,
      getPlayerAllTimeRank: async () => null,
      resetWeekly: async () => {},
    };

    txManager = new FakeTransactionManager();
    geoCalculator = {
      calculateDistanceMeters: () => 10,
    };
    eventBus = {
      publish: async () => {},
      subscribe: () => () => {},
      clear: () => {},
    };

    useCase = new ClaimSpawnUseCase(
      spawnRepo,
      playerRepo,
      claimRepo,
      leaderboardRepo,
      geoCalculator,
      eventBus,
      txManager
    );

    controller = new ClaimController(useCase, { execute: async () => [] } as any);
  });

  describe('1. Authentication Guard', () => {
    it('should reject unauthenticated request with 401 Unauthorized via middleware', () => {
      const req: any = { headers: {} };
      const res: any = {};
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should return 401 if req.user and req.body.playerId are absent in controller', async () => {
      const req: any = { body: { spawnId: 'spawn-test-01' } };
      let errReceived: any = null;

      await controller.submitClaim(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });
  });

  describe('2. Request Validation', () => {
    it('should reject missing spawnId with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'player-test-01', email: 'runner@campus.edu', username: 'campus_runner', role: 'STUDENT' },
        body: {},
      };
      let errReceived: any = null;

      await controller.submitClaim(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
      assert.match(errReceived.message, /spawnId is required/i);
    });
  });

  describe('3. Successful Claim Execution', () => {
    it('should successfully submit claim for current authenticated user and award points exactly once', async () => {
      const req: any = {
        user: { id: 'player-test-01', email: 'runner@campus.edu', username: 'campus_runner', role: 'STUDENT' },
        body: {
          spawnId: 'spawn-test-01',
          lat: 12.9716,
          lng: 77.5946,
        },
      };

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

      await controller.submitClaim(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 201);
      assert.equal(responseBody.success, true);
      assert.ok(responseBody.data);
      assert.ok(responseBody.data.claimId);
      assert.equal(responseBody.data.spawnId, 'spawn-test-01');
      assert.equal(responseBody.data.spawnCode, 'LIB01');
      assert.equal(responseBody.data.pointsAwarded, 100);
      assert.equal(responseBody.data.tier, 'tier1');
      assert.ok(responseBody.data.claimedAt);

      // Verify points awarded exactly once
      assert.equal(player.props.totalPoints, 600); // 500 + 100
      assert.equal(player.props.seasonPoints, 300); // 200 + 100
      assert.equal(player.props.claimsCount, 6); // 5 + 1
    });

    it('should support minimal request body with spawnId only and default to spawn coordinates', async () => {
      const req: any = {
        user: { id: 'player-test-01', email: 'runner@campus.edu', username: 'campus_runner', role: 'STUDENT' },
        body: {
          spawnId: 'spawn-test-01',
        },
      };

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

      await controller.submitClaim(req, res, (err) => {
        assert.fail(`Unexpected controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 201);
      assert.equal(responseBody.success, true);
      assert.equal(responseBody.data.pointsAwarded, 100);
    });
  });

  describe('4. Duplicate Claim Rejection & Concurrency Protection', () => {
    it('should reject a second duplicate claim attempt with controlled 409 ALREADY_CLAIMED error without altering points', async () => {
      const req: any = {
        user: { id: 'player-test-01', email: 'runner@campus.edu', username: 'campus_runner', role: 'STUDENT' },
        body: { spawnId: 'spawn-test-01' },
      };

      const res: any = {
        status() {
          return this;
        },
        json() {},
      };

      // First claim succeeds
      await controller.submitClaim(req, res, (err) => {
        assert.fail(`First claim failed unexpectedly: ${err}`);
      });
      assert.equal(player.props.totalPoints, 600);

      // Second duplicate claim attempt must fail
      let secondClaimErr: any = null;
      await controller.submitClaim(req, res, (err) => {
        secondClaimErr = err;
      });

      assert.ok(secondClaimErr);
      assert.equal(secondClaimErr.statusCode, 409);
      assert.equal(secondClaimErr.code, ErrorCodes.ALREADY_CLAIMED);
      assert.match(secondClaimErr.message, /already claimed/i);

      // Verify points were NOT incremented again
      assert.equal(player.props.totalPoints, 600);
      assert.equal(player.props.claimsCount, 6);
    });

    it('should handle simultaneous concurrent claim requests allowing only 1 winner', async () => {
      const responses: { statusCode?: number; error?: any }[] = [];

      const makeConcurrentRequest = () => {
        return new Promise<void>((resolve) => {
          const req: any = {
            user: { id: 'player-test-01', email: 'runner@campus.edu', username: 'campus_runner', role: 'STUDENT' },
            body: { spawnId: 'spawn-test-01' },
          };

          const res: any = {
            status(code: number) {
              responses.push({ statusCode: code });
              return this;
            },
            json() {
              resolve();
            },
          };

          controller.submitClaim(req, res, (err: any) => {
            responses.push({ error: err, statusCode: err?.statusCode });
            resolve();
          });
        });
      };

      await Promise.all([
        makeConcurrentRequest(),
        makeConcurrentRequest(),
        makeConcurrentRequest(),
        makeConcurrentRequest(),
      ]);

      const successes = responses.filter((r) => r.statusCode === 201);
      const duplicates = responses.filter((r) => r.statusCode === 409 || r.error?.code === ErrorCodes.ALREADY_CLAIMED);

      assert.equal(successes.length, 1, 'Exactly one request should return 201');
      assert.equal(duplicates.length, 3, 'Remaining concurrent requests must return duplicate error');
      assert.equal(player.props.totalPoints, 600); // 500 + 100 once
    });
  });

  describe('5. Error Handling for Missing and Inactive Spawns', () => {
    it('should return 404 NotFoundError when spawn does not exist', async () => {
      const req: any = {
        user: { id: 'player-test-01', email: 'runner@campus.edu', username: 'campus_runner', role: 'STUDENT' },
        body: { spawnId: 'non-existent-spawn' },
      };
      let errReceived: any = null;

      await controller.submitClaim(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 404);
      assert.match(errReceived.message, /not found/i);
    });

    it('should return controlled domain error when attempting to claim an expired spawn', async () => {
      const req: any = {
        user: { id: 'player-test-01', email: 'runner@campus.edu', username: 'campus_runner', role: 'STUDENT' },
        body: { spawnId: 'spawn-test-02' }, // expired spawn
      };
      let errReceived: any = null;

      await controller.submitClaim(req, {} as any, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.ok(errReceived instanceof DomainError);
      assert.match(errReceived.message, /expired|active/i);
    });
  });
});
