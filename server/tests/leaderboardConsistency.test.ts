import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimSpawnUseCase } from '../services/ClaimSpawnUseCase';
import { GetLeaderboardUseCase } from '../services/GetLeaderboardUseCase';
import { ResetWeeklyLeaderboardUseCase } from '../services/ResetWeeklyLeaderboardUseCase';
import { AdminController } from '../controllers/AdminController';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { Player } from '../domain/entities/Player';
import { Claim } from '../domain/entities/Claim';
import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { IClaimRepository } from '../repositories/IClaimRepository';
import { ILeaderboardRepository, LeaderboardRecord } from '../repositories/ILeaderboardRepository';
import { ITransactionManager, ITransactionContext } from '../repositories/ITransactionManager';
import { IGeofencingService } from '../domain/rules';
import { IEventBus, EventHandler } from '../events/IEventBus';
import { IDomainEvent } from '../domain/events/IDomainEvent';
import { PostgresLeaderboardRepository } from '../infrastructure/repositories/postgres/PostgresLeaderboardRepository';

describe('Leaderboard Consistency & Weekly Reset Rules', () => {
  let playerRecords: Map<string, { total_points: number; season_points: number; username: string }>;
  let claimsMap: Map<string, Claim>;
  let uniqueClaimKeys: Set<string>;

  let playerRepo: IPlayerRepository;
  let claimRepo: IClaimRepository;
  let spawnRepo: ISpawnRepository;
  let leaderboardRepo: ILeaderboardRepository;
  let txManager: ITransactionManager;
  let geoCalculator: IGeofencingService;
  let eventBus: IEventBus;

  let claimUseCase: ClaimSpawnUseCase;
  let leaderboardUseCase: GetLeaderboardUseCase;
  let resetUseCase: ResetWeeklyLeaderboardUseCase;

  const SPAWN_ID = 'spawn_gym_01';
  const PLAYER_1 = 'usr_runner_1';
  const PLAYER_2 = 'usr_runner_2';

  beforeEach(() => {
    playerRecords = new Map([
      [PLAYER_1, { total_points: 1000, season_points: 300, username: 'speedy' }],
      [PLAYER_2, { total_points: 800, season_points: 400, username: 'steady' }],
    ]);
    claimsMap = new Map();
    uniqueClaimKeys = new Set();

    const spawn = new SpawnPoint({
      id: SPAWN_ID,
      code: 'GYM01',
      title: 'Gym Entrance',
      zoneId: 'zone_south',
      zoneName: 'South Campus',
      coordinates: { lat: 12.9716, lng: 77.5946 },
      svgCoordinates: { x: 50, y: 50 },
      points: 200, // 200 pts
      tier: 'tier2',
      status: 'active',
      claimRadiusMeters: 25,
      enabled: true,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      claimCount: 0,
    });

    spawnRepo = {
      findById: async () => spawn,
      findByCode: async () => spawn,
      findActive: async () => [spawn],
      findWithinBounds: async () => [spawn],
      findNearby: async () => [spawn],
      save: async () => {},
      updateStatus: async () => {},
    };

    playerRepo = {
      findById: async (id: string) => {
        const p = playerRecords.get(id);
        if (!p) return null;
        return new Player({
          id,
          email: `${p.username}@campus.edu`,
          username: p.username,
          totalPoints: p.total_points,
          seasonPoints: p.season_points,
          rank: 1,
          tier: 'tier1',
          claimsCount: 1,
          currentStreakDays: 1,
          role: 'player',
          createdAt: new Date(),
          lastActiveAt: new Date(),
        });
      },
      updatePointsTx: async (id: string, additionalPoints: number) => {
        const p = playerRecords.get(id);
        if (p) {
          p.total_points += additionalPoints;
          p.season_points += additionalPoints;
        }
      },
      findByEmail: async () => null,
      findByUsername: async () => null,
      save: async () => {},
      updatePoints: async () => {},
      incrementStreak: async () => {},
    };

    claimRepo = {
      countBySpawnAndPlayer: async (sId, pId) => (uniqueClaimKeys.has(`${pId}:${sId}`) ? 1 : 0),
      saveTx: async (claim) => {
        const key = `${claim.playerId}:${claim.spawnId}`;
        if (uniqueClaimKeys.has(key)) return false;
        uniqueClaimKeys.add(key);
        claimsMap.set(claim.id, claim);
        return true;
      },
      findById: async () => null,
      findByPlayerId: async () => [],
      save: async () => {},
      findRecent: async () => [],
    };

    leaderboardRepo = {
      getWeekly: async (limit = 20, offset = 0): Promise<LeaderboardRecord[]> => {
        const list = Array.from(playerRecords.entries()).map(([id, p]) => ({
          rank: 0,
          profile_id: id,
          playerId: id,
          username: p.username,
          points: p.season_points,
          claimsCount: 1,
          tier: 'tier1' as const,
          rankChange: 'same' as const,
        }));

        list.sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          return a.profile_id.localeCompare(b.profile_id);
        });

        return list.map((r, i) => ({ ...r, rank: i + 1 })).slice(offset, offset + limit);
      },
      getAllTime: async (limit = 20, offset = 0): Promise<LeaderboardRecord[]> => {
        const list = Array.from(playerRecords.entries()).map(([id, p]) => ({
          rank: 0,
          profile_id: id,
          playerId: id,
          username: p.username,
          points: p.total_points,
          claimsCount: 1,
          tier: 'tier1' as const,
          rankChange: 'same' as const,
        }));

        list.sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          return a.profile_id.localeCompare(b.profile_id);
        });

        return list.map((r, i) => ({ ...r, rank: i + 1 })).slice(offset, offset + limit);
      },
      getPlayerWeeklyRank: async (playerId: string): Promise<number | null> => {
        const p = playerRecords.get(playerId);
        if (!p) return null;
        let rank = 1;
        for (const [id, other] of playerRecords.entries()) {
          if (id === playerId) continue;
          if (other.season_points > p.season_points) rank++;
          else if (other.season_points === p.season_points && id.localeCompare(playerId) < 0) rank++;
        }
        return rank;
      },
      getPlayerAllTimeRank: async (playerId: string): Promise<number | null> => {
        const p = playerRecords.get(playerId);
        if (!p) return null;
        let rank = 1;
        for (const [id, other] of playerRecords.entries()) {
          if (id === playerId) continue;
          if (other.total_points > p.total_points) rank++;
          else if (other.total_points === p.total_points && id.localeCompare(playerId) < 0) rank++;
        }
        return rank;
      },
      recordScore: async () => {},
      resetWeekly: async () => {
        for (const p of playerRecords.values()) {
          p.season_points = 0;
        }
      },
    };

    txManager = {
      runInTransaction: async (work) => work({ query: async () => ({ rows: [], rowCount: 1 }) }),
    };

    geoCalculator = {
      calculateDistanceMeters: () => 5,
    };

    eventBus = {
      publish: async <T>(_event: IDomainEvent<T>) => {},
      subscribe: <T>(_eventName: string, _handler: EventHandler<T>) => () => {},
      clear: () => {},
    };

    claimUseCase = new ClaimSpawnUseCase(
      spawnRepo,
      playerRepo,
      claimRepo,
      leaderboardRepo,
      geoCalculator,
      eventBus,
      txManager
    );

    leaderboardUseCase = new GetLeaderboardUseCase(leaderboardRepo);
    resetUseCase = new ResetWeeklyLeaderboardUseCase(leaderboardRepo);
  });

  it('1. should atomically increment both all-time points and weekly points upon a successful claim', async () => {
    // Initial state:
    // Player 1: total = 1000, weekly = 300 (Weekly rank: 2, All-time rank: 1)
    // Player 2: total = 800,  weekly = 400 (Weekly rank: 1, All-time rank: 2)
    const initialWeekly = await leaderboardUseCase.execute('weekly');
    assert.equal(initialWeekly[0].playerId, PLAYER_2); // 400 pts
    assert.equal(initialWeekly[1].playerId, PLAYER_1); // 300 pts

    // Player 1 claims 200 points
    const claimRes = await claimUseCase.execute({
      spawnId: SPAWN_ID,
      playerId: PLAYER_1,
      playerCoordinates: { lat: 12.9716, lng: 77.5946 },
    });
    assert.equal(claimRes.success, true);
    assert.equal(claimRes.pointsAwarded, 200);

    // Verify Player 1 points: total 1000 + 200 = 1200, weekly 300 + 200 = 500
    const p1 = playerRecords.get(PLAYER_1);
    assert.equal(p1?.total_points, 1200, 'All-time points must increase to 1200');
    assert.equal(p1?.season_points, 500, 'Weekly season points must increase to 500');

    // Verify Weekly leaderboard ranking immediately reflects update (Player 1 moves to Rank 1 with 500 pts)
    const updatedWeekly = await leaderboardUseCase.execute('weekly');
    assert.equal(updatedWeekly[0].playerId, PLAYER_1);
    assert.equal(updatedWeekly[0].points, 500);
    assert.equal(updatedWeekly[0].rank, 1);

    const rankP1Weekly = await leaderboardUseCase.getPlayerWeeklyRank(PLAYER_1);
    assert.equal(rankP1Weekly.rank, 1);

    // Verify All-Time leaderboard ranking (Player 1 remains Rank 1 with 1200 pts)
    const updatedAllTime = await leaderboardUseCase.execute('all-time');
    assert.equal(updatedAllTime[0].playerId, PLAYER_1);
    assert.equal(updatedAllTime[0].points, 1200);
    assert.equal(updatedAllTime[0].rank, 1);
  });

  it('2. should perform weekly reset setting season_points to 0 while preserving total_points and all-time rankings', async () => {
    // Perform weekly reset
    const resetResult = await resetUseCase.execute();
    assert.equal(resetResult.success, true);

    // Verify all players have season_points = 0
    const p1 = playerRecords.get(PLAYER_1);
    const p2 = playerRecords.get(PLAYER_2);
    assert.equal(p1?.season_points, 0, 'Player 1 season_points must be 0');
    assert.equal(p2?.season_points, 0, 'Player 2 season_points must be 0');

    // Verify all-time points remain completely unchanged
    assert.equal(p1?.total_points, 1000, 'Player 1 total_points must remain 1000');
    assert.equal(p2?.total_points, 800, 'Player 2 total_points must remain 800');

    // Verify All-Time leaderboard remains intact and accurate
    const allTimeLeaderboard = await leaderboardUseCase.execute('all-time');
    assert.equal(allTimeLeaderboard[0].playerId, PLAYER_1);
    assert.equal(allTimeLeaderboard[0].points, 1000);
    assert.equal(allTimeLeaderboard[0].rank, 1);

    assert.equal(allTimeLeaderboard[1].playerId, PLAYER_2);
    assert.equal(allTimeLeaderboard[1].points, 800);
    assert.equal(allTimeLeaderboard[1].rank, 2);

    // Verify weekly leaderboard reflects 0 points with deterministic tie-breaker
    const weeklyLeaderboard = await leaderboardUseCase.execute('weekly');
    assert.equal(weeklyLeaderboard[0].points, 0);
    assert.equal(weeklyLeaderboard[1].points, 0);
    assert.equal(weeklyLeaderboard[0].playerId, PLAYER_1); // usr_runner_1 < usr_runner_2
    assert.equal(weeklyLeaderboard[1].playerId, PLAYER_2);
  });

  it('3. should expose weekly reset via AdminController without modifying all-time state', async () => {
    const adminController = new AdminController(
      {} as any,
      {} as any,
      {} as any,
      resetUseCase
    );

    let responseStatus = 200;
    let responseBody: any = null;

    const req: any = {};
    const res: any = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      json(data: any) {
        responseBody = data;
      },
    };

    const next = (err: any) => {
      throw err;
    };

    await adminController.resetWeeklyLeaderboard(req, res, next);

    assert.equal(responseStatus, 200);
    assert.equal(responseBody.success, true);
    assert(responseBody.data.message.includes('season_points have been reset to 0'));

    // Check that total_points still intact
    assert.equal(playerRecords.get(PLAYER_1)?.total_points, 1000);
  });
});

describe('PostgresLeaderboardRepository SQL Consistency Verification', () => {
  it('should execute UPDATE profiles SET season_points = 0 on resetWeekly', async () => {
    let capturedQuery = '';

    const mockPool = {
      query: async (text: string) => {
        capturedQuery = text;
        return { rows: [], rowCount: 1 };
      },
    } as any;

    const repo = new PostgresLeaderboardRepository(mockPool);
    await repo.resetWeekly();

    assert(capturedQuery.includes('UPDATE profiles SET season_points = 0'), 'Query must reset season_points to 0');
    assert(!capturedQuery.includes('total_points = 0'), 'Query must NOT reset total_points');
    assert(!capturedQuery.includes('DELETE'), 'Query must NOT delete rows');
  });
});
