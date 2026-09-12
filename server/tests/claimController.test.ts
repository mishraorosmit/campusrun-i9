import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ClaimController } from '../controllers/ClaimController';
import { ClaimSpawnUseCase } from '../services/ClaimSpawnUseCase';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { Player } from '../domain/entities/Player';
import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { IClaimRepository } from '../repositories/IClaimRepository';
import { ILeaderboardRepository, LeaderboardRecord } from '../repositories/ILeaderboardRepository';
import { ITransactionManager } from '../repositories/ITransactionManager';
import { IGeofencingService } from '../domain/rules';
import { IEventBus, EventHandler } from '../events/IEventBus';
import { IDomainEvent } from '../domain/events/IDomainEvent';
import { DomainError, ErrorCodes } from '../errors';

describe('ClaimController Concurrent Duplicate Requests', () => {
  let claimRepoUniqueSet: Set<string>;
  let playerPoints: number;
  let useCase: ClaimSpawnUseCase;
  let controller: ClaimController;

  const SPAWN_ID = 'spawn_chem_02';
  const PLAYER_ID = 'player_usr_200';

  beforeEach(() => {
    claimRepoUniqueSet = new Set<string>();
    playerPoints = 0;

    const spawn = new SpawnPoint({
      id: SPAWN_ID,
      code: 'CHEM02',
      title: 'Chemistry Lab Fountain',
      zoneId: 'zone_east',
      zoneName: 'East Campus',
      coordinates: { lat: 12.9716, lng: 77.5946 },
      svgCoordinates: { x: 50, y: 50 },
      points: 75,
      tier: 'tier1',
      status: 'active',
      claimRadiusMeters: 25,
      enabled: true,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      claimCount: 0,
    });

    const player = new Player({
      id: PLAYER_ID,
      email: 'runner2@campus.edu',
      username: 'runner_two',
      totalPoints: 0,
      seasonPoints: 0,
      rank: 2,
      tier: 'tier1',
      claimsCount: 0,
      currentStreakDays: 1,
      role: 'player',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    });

    const spawnRepo: ISpawnRepository = {
      findById: async () => spawn,
      findByCode: async () => spawn,
      findActive: async () => [spawn],
      findWithinBounds: async () => [spawn],
      findNearby: async () => [spawn],
      save: async () => {},
      updateStatus: async () => {},
    };

    const playerRepo: IPlayerRepository = {
      findById: async () => player,
      updatePointsTx: async (_id, pts) => {
        playerPoints += pts;
      },
      findByEmail: async () => null,
      findByUsername: async () => null,
      save: async () => {},
      updatePoints: async () => {},
      incrementStreak: async () => {},
    };

    const claimRepo: IClaimRepository = {
      countBySpawnAndPlayer: async (sId, pId) => (claimRepoUniqueSet.has(`${pId}:${sId}`) ? 1 : 0),
      saveTx: async (claim, _tx) => {
        const key = `${claim.playerId}:${claim.spawnId}`;
        if (claimRepoUniqueSet.has(key)) return false;
        claimRepoUniqueSet.add(key);
        return true;
      },
      findById: async () => null,
      findByPlayerId: async () => [],
      save: async () => {},
      findRecent: async () => [],
    };

    const leaderboardRepo: ILeaderboardRepository = {
      recordScore: async () => {},
      getWeekly: async (): Promise<LeaderboardRecord[]> => [],
      getAllTime: async (): Promise<LeaderboardRecord[]> => [],
      getPlayerWeeklyRank: async () => null,
      getPlayerAllTimeRank: async () => null,
      resetWeekly: async () => {},
    };

    const txManager: ITransactionManager = {
      runInTransaction: async (work) => work({ query: async () => ({ rows: [], rowCount: 1 }) }),
    };

    const geoCalculator: IGeofencingService = {
      calculateDistanceMeters: () => 5,
    };

    const eventBus: IEventBus = {
      publish: async <T>(_event: IDomainEvent<T>) => {},
      subscribe: <T>(_eventName: string, _handler: EventHandler<T>) => () => {},
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

  it('should handle simultaneous controller calls returning 201 for winner and error for duplicate', async () => {
    const responses: { statusCode?: number; body?: any; error?: any }[] = [];

    const makeRequest = () => {
      return new Promise<void>((resolve) => {
        const req: any = {
          body: {
            spawnId: SPAWN_ID,
            playerId: PLAYER_ID,
            lat: 12.9716,
            lng: 77.5946,
          },
        };

        const res: any = {
          statusCode: 200,
          status(code: number) {
            this.statusCode = code;
            return this;
          },
          json(data: any) {
            responses.push({ statusCode: this.statusCode, body: data });
            resolve();
          },
        };

        const next = (err: any) => {
          responses.push({ error: err });
          resolve();
        };

        controller.submitClaim(req, res, next);
      });
    };

    // Run 5 simultaneous controller requests
    await Promise.all([makeRequest(), makeRequest(), makeRequest(), makeRequest(), makeRequest()]);

    const successes = responses.filter((r) => r.statusCode === 201);
    const errors = responses.filter((r) => r.error);

    assert.equal(successes.length, 1, 'Exactly one request should return HTTP 201');
    assert.equal(errors.length, 4, 'Other 4 requests must pass error to next()');

    for (const errResp of errors) {
      assert(errResp.error instanceof DomainError);
      assert.equal(errResp.error.code, ErrorCodes.ALREADY_CLAIMED);
    }

    // Assert points increased only once
    assert.equal(playerPoints, 75);
  });
});
