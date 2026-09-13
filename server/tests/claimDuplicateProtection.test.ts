import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimSpawnUseCase } from '../services/ClaimSpawnUseCase';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { Player } from '../domain/entities/Player';
import { Claim } from '../domain/entities/Claim';
import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { IClaimRepository } from '../repositories/IClaimRepository';
import { ILeaderboardRepository, LeaderboardRecord } from '../repositories/ILeaderboardRepository';
import { ITransactionManager, ITransactionContext, IQueryResult } from '../repositories/ITransactionManager';
import { IGeofencingService } from '../domain/rules';
import { IEventBus, EventHandler } from '../events/IEventBus';
import { IDomainEvent } from '../domain/events/IDomainEvent';
import { DomainError, ErrorCodes } from '../errors';
import { PostgresClaimRepository } from '../infrastructure/repositories/postgres/PostgresClaimRepository';

// --- Test Fakes & In-Memory Transactional Harness ---

class FakeTransactionManager implements ITransactionManager {
  public beginCount = 0;
  public commitCount = 0;
  public rollbackCount = 0;

  async runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    this.beginCount++;
    const dummyTx: ITransactionContext = {
      query: async <R = Record<string, unknown>>() => ({ rows: [] as R[], rowCount: 1 }),
    };

    try {
      const result = await work(dummyTx);
      this.commitCount++;
      return result;
    } catch (err) {
      this.rollbackCount++;
      throw err;
    }
  }
}

/**
 * Transactional In-Memory Claim Repository simulating PostgreSQL UNIQUE(player_id, spawn_id)
 * and atomic concurrency behavior.
 */
class TransactionalClaimRepository implements IClaimRepository {
  public claims = new Map<string, Claim>();
  // Set of player_id + spawn_id keys representing persisted unique constraints
  public uniqueConstraints = new Set<string>();

  async countBySpawnAndPlayer(spawnId: string, playerId: string): Promise<number> {
    const key = `${playerId}:${spawnId}`;
    return this.uniqueConstraints.has(key) ? 1 : 0;
  }

  async saveTx(claim: Claim, _tx: ITransactionContext): Promise<boolean> {
    const key = `${claim.playerId}:${claim.spawnId}`;
    // Simulate atomic ON CONFLICT (player_id, spawn_id) DO NOTHING
    if (this.uniqueConstraints.has(key)) {
      return false; // 0 rows inserted due to conflict
    }
    this.uniqueConstraints.add(key);
    this.claims.set(claim.id, claim);
    return true; // 1 row inserted
  }

  async hasClaimed(spawnId: string, playerId: string): Promise<boolean> {
    return this.uniqueConstraints.has(`${playerId}:${spawnId}`);
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

  async findRecent(): Promise<Claim[]> {
    return Array.from(this.claims.values());
  }
}

/**
 * Transactional In-Memory Player Repository supporting atomic updates & rollbacks
 */
class TransactionalPlayerRepository implements IPlayerRepository {
  public players = new Map<string, Player>();

  constructor(player: Player) {
    this.players.set(player.id, player);
  }

  async findById(id: string): Promise<Player | null> {
    return this.players.get(id) || null;
  }

  async updatePointsTx(id: string, additionalPoints: number, _tx: ITransactionContext): Promise<void> {
    const player = this.players.get(id);
    if (!player) return;
    const updated = new Player({
      ...player.props,
      totalPoints: player.props.totalPoints + additionalPoints,
      seasonPoints: player.props.seasonPoints + additionalPoints,
      claimsCount: player.props.claimsCount + 1,
    });
    this.players.set(id, updated);
  }

  async findByEmail(): Promise<Player | null> { return null; }
  async findByUsername(): Promise<Player | null> { return null; }
  async save(player: Player): Promise<void> { this.players.set(player.id, player); }
  async updatePoints(): Promise<void> {}
  async incrementStreak(): Promise<void> {}
}

class FakeSpawnRepository implements ISpawnRepository {
  constructor(private spawn: SpawnPoint) {}
  async create(s: SpawnPoint): Promise<SpawnPoint> { return s; }
  async update(s: SpawnPoint): Promise<SpawnPoint> { return s; }
  async findAll(): Promise<SpawnPoint[]> { return [this.spawn]; }
  async findAvailableForBatch(): Promise<SpawnPoint[]> { return [this.spawn]; }
  async findById(): Promise<SpawnPoint | null> { return this.spawn; }
  async findByCode(): Promise<SpawnPoint | null> { return this.spawn; }
  async findActive(): Promise<SpawnPoint[]> { return [this.spawn]; }
  async findWithinBounds(): Promise<SpawnPoint[]> { return [this.spawn]; }
  async findNearby(): Promise<SpawnPoint[]> { return [this.spawn]; }
  async save(): Promise<void> {}
  async updateStatus(): Promise<void> {}
}

class FakeLeaderboardRepository implements ILeaderboardRepository {
  public recordedScores: { playerId: string; points: number }[] = [];
  async recordScore(playerId: string, points: number): Promise<void> {
    this.recordedScores.push({ playerId, points });
  }
  async getWeekly(): Promise<LeaderboardRecord[]> { return []; }
  async getAllTime(): Promise<LeaderboardRecord[]> { return []; }
  async getPlayerWeeklyRank(): Promise<number | null> { return null; }
  async getPlayerAllTimeRank(): Promise<number | null> { return null; }
  async resetWeekly(): Promise<void> {}
}

class FakeGeoCalculator implements IGeofencingService {
  calculateDistanceMeters(): number {
    return 10; // Within claim radius (25m)
  }
}

class FakeEventBus implements IEventBus {
  public publishedEvents: any[] = [];
  async publish<T>(event: IDomainEvent<T>): Promise<void> {
    this.publishedEvents.push(event);
  }
  subscribe<T>(_eventName: string, _handler: EventHandler<T>): () => void {
    return () => {};
  }
  clear(): void {}
}

// --- Test Suites ---

describe('Campus Run Claim Duplicate & Race Protection', () => {
  let spawn: SpawnPoint;
  let player: Player;
  let spawnRepo: FakeSpawnRepository;
  let playerRepo: TransactionalPlayerRepository;
  let claimRepo: TransactionalClaimRepository;
  let leaderboardRepo: FakeLeaderboardRepository;
  let txManager: FakeTransactionManager;
  let geoCalculator: FakeGeoCalculator;
  let eventBus: FakeEventBus;
  let useCase: ClaimSpawnUseCase;

  const SPAWN_ID = 'spawn_lib_01';
  const PLAYER_ID = 'player_usr_100';
  const SPAWN_POINTS = 150;

  beforeEach(() => {
    spawn = new SpawnPoint({
      id: SPAWN_ID,
      code: 'LIB01',
      title: 'Library Front Lawn',
      zoneId: 'zone_north',
      zoneName: 'North Campus',
      coordinates: { lat: 12.9716, lng: 77.5946 },
      svgCoordinates: { x: 100, y: 200 },
      points: SPAWN_POINTS,
      tier: 'tier2',
      status: 'active',
      claimRadiusMeters: 25,
      enabled: true,
      expiresAt: new Date(Date.now() + 3600 * 1000), // Valid for 1 hr
      claimCount: 0,
    });

    player = new Player({
      id: PLAYER_ID,
      email: 'runner@campus.edu',
      username: 'speedy_runner',
      totalPoints: 0,
      seasonPoints: 0,
      rank: 1,
      tier: 'tier1',
      claimsCount: 0,
      currentStreakDays: 1,
      role: 'player',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });

    spawnRepo = new FakeSpawnRepository(spawn);
    playerRepo = new TransactionalPlayerRepository(player);
    claimRepo = new TransactionalClaimRepository();
    leaderboardRepo = new FakeLeaderboardRepository();
    txManager = new FakeTransactionManager();
    geoCalculator = new FakeGeoCalculator();
    eventBus = new FakeEventBus();

    useCase = new ClaimSpawnUseCase(
      spawnRepo,
      playerRepo,
      claimRepo,
      leaderboardRepo,
      geoCalculator,
      eventBus,
      txManager
    );
  });

  it('1. should not allow a player to claim the same spawn twice sequentially', async () => {
    // First claim succeeds
    const firstResult = await useCase.execute({
      spawnId: SPAWN_ID,
      playerId: PLAYER_ID,
      playerCoordinates: { lat: 12.9716, lng: 77.5946 },
    });
    assert.equal(firstResult.success, true);
    assert.equal(firstResult.pointsAwarded, SPAWN_POINTS);

    // Second claim must fail
    await assert.rejects(
      async () => {
        await useCase.execute({
          spawnId: SPAWN_ID,
          playerId: PLAYER_ID,
          playerCoordinates: { lat: 12.9716, lng: 77.5946 },
        });
      },
      (err: any) => {
        assert(err instanceof DomainError);
        assert.equal(err.code, ErrorCodes.ALREADY_CLAIMED);
        return true;
      }
    );
  });

  it('2. should result in only one successful claim when simultaneous duplicate attempts occur', async () => {
    const concurrentAttempts = 10;
    const promises = Array.from({ length: concurrentAttempts }, () =>
      useCase.execute({
        spawnId: SPAWN_ID,
        playerId: PLAYER_ID,
        playerCoordinates: { lat: 12.9716, lng: 77.5946 },
      })
    );

    const results = await Promise.allSettled(promises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    // Exactly one attempt succeeds
    assert.equal(fulfilled.length, 1, 'Only 1 claim must succeed out of simultaneous attempts');
    assert.equal(rejected.length, concurrentAttempts - 1, 'All other concurrent attempts must be rejected');

    // All rejected attempts must have ALREADY_CLAIMED error code
    for (const rej of rejected) {
      assert(rej.reason instanceof DomainError);
      assert.equal(rej.reason.code, ErrorCodes.ALREADY_CLAIMED);
    }

    // Only 1 claim entry exists in repository
    assert.equal(claimRepo.claims.size, 1);
  });

  it('3. should increase player points exactly once after a successful claim', async () => {
    const initialPlayer = await playerRepo.findById(PLAYER_ID);
    assert.equal(initialPlayer?.totalPoints, 0);

    await useCase.execute({
      spawnId: SPAWN_ID,
      playerId: PLAYER_ID,
      playerCoordinates: { lat: 12.9716, lng: 77.5946 },
    });

    const updatedPlayer = await playerRepo.findById(PLAYER_ID);
    assert.equal(updatedPlayer?.totalPoints, SPAWN_POINTS);
    assert.equal(updatedPlayer?.props.claimsCount, 1);
  });

  it('4. should not change player points on duplicate claim attempts', async () => {
    // First claim: 0 -> 150 points
    await useCase.execute({
      spawnId: SPAWN_ID,
      playerId: PLAYER_ID,
      playerCoordinates: { lat: 12.9716, lng: 77.5946 },
    });

    const playerAfterFirstClaim = await playerRepo.findById(PLAYER_ID);
    const pointsAfterFirstClaim = playerAfterFirstClaim?.totalPoints;
    assert.equal(pointsAfterFirstClaim, SPAWN_POINTS);

    // Duplicate attempt 1 (sequential)
    try {
      await useCase.execute({
        spawnId: SPAWN_ID,
        playerId: PLAYER_ID,
        playerCoordinates: { lat: 12.9716, lng: 77.5946 },
      });
    } catch {
      // expected rejection
    }

    const playerAfterDuplicate = await playerRepo.findById(PLAYER_ID);
    assert.equal(playerAfterDuplicate?.totalPoints, pointsAfterFirstClaim, 'Player points must not change');
    assert.equal(playerAfterDuplicate?.props.claimsCount, 1, 'Player claimsCount must not change');

    // Duplicate attempt 2 (simulated bypass of pre-check hitting DB conflict)
    // Even if countBySpawnAndPlayer returned 0, saveTx returning false rejects the claim
    claimRepo.countBySpawnAndPlayer = async () => 0; // Simulate race where pre-check passed
    try {
      await useCase.execute({
        spawnId: SPAWN_ID,
        playerId: PLAYER_ID,
        playerCoordinates: { lat: 12.9716, lng: 77.5946 },
      });
    } catch {
      // expected rejection
    }

    const playerAfterRaceDuplicate = await playerRepo.findById(PLAYER_ID);
    assert.equal(playerAfterRaceDuplicate?.totalPoints, SPAWN_POINTS, 'Points must remain unchanged');
  });

  it('5. should not leave partial database state if a claim operation fails mid-transaction', async () => {
    // Create a transaction manager that simulates atomic rollback on error
    let stateRolledBack = false;
    const rollbackTxManager: ITransactionManager = {
      async runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> {
        try {
          return await work({ query: async () => ({ rows: [], rowCount: 1 }) });
        } catch (err) {
          stateRolledBack = true;
          throw err;
        }
      },
    };

    // Simulate playerRepo failing during points update inside transaction
    const failingPlayerRepo: IPlayerRepository = {
      ...playerRepo,
      async updatePointsTx(): Promise<void> {
        throw new Error('Database disk write error during points update');
      },
      findById: (id: string) => playerRepo.findById(id),
    } as any;

    const failingUseCase = new ClaimSpawnUseCase(
      spawnRepo,
      failingPlayerRepo,
      claimRepo,
      leaderboardRepo,
      geoCalculator,
      eventBus,
      rollbackTxManager
    );

    // Execution must fail and throw
    await assert.rejects(
      async () => {
        await failingUseCase.execute({
          spawnId: SPAWN_ID,
          playerId: PLAYER_ID,
          playerCoordinates: { lat: 12.9716, lng: 77.5946 },
        });
      },
      /Database disk write error/
    );

    // Assert transaction rollback was executed
    assert.equal(stateRolledBack, true, 'Transaction must trigger rollback on error');

    // Assert no points were awarded and leaderboard was not touched
    const playerAfterFailure = await playerRepo.findById(PLAYER_ID);
    assert.equal(playerAfterFailure?.totalPoints, 0, 'Points must remain 0');
    assert.equal(leaderboardRepo.recordedScores.length, 0, 'Leaderboard must not record failed claim');
    assert.equal(eventBus.publishedEvents.length, 0, 'Domain event must not be published on failure');
  });
});

describe('PostgresClaimRepository ON CONFLICT DO NOTHING Verification', () => {
  it('should execute INSERT ON CONFLICT DO NOTHING and return true on insert, false on conflict', async () => {
    let capturedQuery = '';
    let capturedParams: any[] = [];

    // Mock tx context returning rowCount = 1 for first insert, rowCount = 0 for duplicate
    let simulateConflict = false;
    const mockTx: ITransactionContext = {
      query: async (text: string, params: unknown[] = []): Promise<IQueryResult<any>> => {
        capturedQuery = text;
        capturedParams = params;
        return {
          rows: [],
          rowCount: simulateConflict ? 0 : 1,
        };
      },
    };

    const repo = new PostgresClaimRepository({} as any);

    const testClaim = new Claim({
      id: 'claim_123',
      spawnId: 'spawn_456',
      spawnCode: 'LIB01',
      spawnTitle: 'Library',
      playerId: 'player_789',
      zoneName: 'North Zone',
      pointsAwarded: 100,
      claimedAt: new Date(),
      tier: 'tier1',
      playerCoordinates: { lat: 12.97, lng: 77.59 },
      distanceAtClaimMeters: 5,
    });

    // 1. Initial claim insert
    const insertResult = await repo.saveTx(testClaim, mockTx);
    assert.equal(insertResult, true, 'First insert must return true');
    assert(capturedQuery.includes('ON CONFLICT (player_id, spawn_id) DO NOTHING'), 'Query must contain ON CONFLICT clause');
    assert.equal(capturedParams[1], 'player_789');
    assert.equal(capturedParams[2], 'spawn_456');

    // 2. Conflict claim insert (duplicate row exists)
    simulateConflict = true;
    const conflictResult = await repo.saveTx(testClaim, mockTx);
    assert.equal(conflictResult, false, 'Duplicate insert must return false (0 rows affected)');
  });
});
