import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../controllers/PlayerController';
import { GetPlayerProfileUseCase } from '../services/GetPlayerProfileUseCase';
import { UpdatePlayerPreferencesUseCase } from '../services/UpdatePlayerPreferencesUseCase';
import { GetPlayerStatsUseCase } from '../services/GetPlayerStatsUseCase';
import { GetClaimsHistoryUseCase } from '../services/GetClaimsHistoryUseCase';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { InMemoryClaimRepository } from '../infrastructure/repositories/inmemory/InMemoryClaimRepository';
import { InMemoryLeaderboardRepository } from '../infrastructure/repositories/inmemory/InMemoryLeaderboardRepository';
import { Player } from '../domain/entities/Player';
import { Claim } from '../domain/entities/Claim';
import { requireCurrentUser } from '../middlewares/auth';

describe('GET /api/v1/me/stats and GET /api/v1/me/claims Endpoints', () => {
  let playerRepo: InMemoryPlayerRepository;
  let claimRepo: InMemoryClaimRepository;
  let leaderboardRepo: InMemoryLeaderboardRepository;
  let getPlayerProfileUseCase: GetPlayerProfileUseCase;
  let updatePlayerPreferencesUseCase: UpdatePlayerPreferencesUseCase;
  let getPlayerStatsUseCase: GetPlayerStatsUseCase;
  let getClaimsHistoryUseCase: GetClaimsHistoryUseCase;
  let playerController: PlayerController;

  const player1 = new Player({
    id: 'usr-stats-1',
    email: 'runner1@campus.edu',
    username: 'campus_legend',
    displayName: 'Campus Legend',
    status: 'active',
    totalPoints: 1200,
    seasonPoints: 400,
    rank: 1,
    tier: 'tier2',
    claimsCount: 8,
    currentStreakDays: 4,
    role: 'STUDENT',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    lastActiveAt: new Date('2026-09-13T00:00:00.000Z'),
  });

  const player2 = new Player({
    id: 'usr-stats-2',
    email: 'runner2@campus.edu',
    username: 'rookie_runner',
    displayName: 'Rookie Runner',
    status: 'active',
    totalPoints: 600,
    seasonPoints: 200,
    rank: 2,
    tier: 'tier1',
    claimsCount: 3,
    currentStreakDays: 1,
    role: 'STUDENT',
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    lastActiveAt: new Date('2026-09-13T00:00:00.000Z'),
  });

  const claim1P1 = new Claim({
    id: 'clm-001',
    spawnId: 'spw-001',
    spawnCode: 'LIB-01',
    spawnTitle: 'Library Entrance',
    playerId: 'usr-stats-1',
    zoneName: 'Central Library',
    pointsAwarded: 50,
    claimedAt: new Date('2026-09-10T10:00:00.000Z'),
    distanceAtClaimMeters: 12.5,
    tier: 'tier1',
    playerCoordinates: { lat: 37.7749, lng: -122.4194 },
  });

  const claim2P1 = new Claim({
    id: 'clm-002',
    spawnId: 'spw-002',
    spawnCode: 'GYM-02',
    spawnTitle: 'Gymnasium Quad',
    playerId: 'usr-stats-1',
    zoneName: 'Athletic Center',
    pointsAwarded: 100,
    claimedAt: new Date('2026-09-12T14:30:00.000Z'), // Newest for player 1
    distanceAtClaimMeters: 8.0,
    tier: 'tier2',
    playerCoordinates: { lat: 37.7750, lng: -122.4190 },
  });

  const claim1P2 = new Claim({
    id: 'clm-003',
    spawnId: 'spw-003',
    spawnCode: 'CAFE-01',
    spawnTitle: 'Student Union Cafe',
    playerId: 'usr-stats-2',
    zoneName: 'Student Union',
    pointsAwarded: 50,
    claimedAt: new Date('2026-09-11T12:00:00.000Z'),
    distanceAtClaimMeters: 5.0,
    tier: 'tier1',
    playerCoordinates: { lat: 37.7760, lng: -122.4180 },
  });

  beforeEach(() => {
    playerRepo = new InMemoryPlayerRepository([
      new Player({ ...player1.props }),
      new Player({ ...player2.props }),
    ]);

    claimRepo = new InMemoryClaimRepository();
    claimRepo.save(claim1P1);
    claimRepo.save(claim2P1);
    claimRepo.save(claim1P2);

    leaderboardRepo = new InMemoryLeaderboardRepository([
      {
        rank: 1,
        profile_id: 'usr-stats-1',
        playerId: 'usr-stats-1',
        username: 'campus_legend',
        points: 400,
        claimsCount: 8,
        tier: 'tier2',
        rankChange: 'same',
      },
      {
        rank: 2,
        profile_id: 'usr-stats-2',
        playerId: 'usr-stats-2',
        username: 'rookie_runner',
        points: 200,
        claimsCount: 3,
        tier: 'tier1',
        rankChange: 'same',
      },
    ]);

    getPlayerProfileUseCase = new GetPlayerProfileUseCase(playerRepo);
    updatePlayerPreferencesUseCase = new UpdatePlayerPreferencesUseCase(playerRepo);
    getPlayerStatsUseCase = new GetPlayerStatsUseCase(playerRepo, leaderboardRepo);
    getClaimsHistoryUseCase = new GetClaimsHistoryUseCase(claimRepo);
    playerController = new PlayerController(
      getPlayerProfileUseCase,
      updatePlayerPreferencesUseCase,
      getPlayerStatsUseCase,
      getClaimsHistoryUseCase
    );
  });

  describe('1. GET /api/v1/me/stats', () => {
    it('should reject unauthenticated request with 401 Unauthorized', () => {
      const req: any = { headers: {} };
      const res: any = {};
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should return the authenticated user stats including all-time and weekly points, claims, and ranks', async () => {
      const req: any = {
        user: { id: 'usr-stats-1', email: 'runner1@campus.edu', username: 'campus_legend', role: 'STUDENT' },
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

      await playerController.getMyStats(req, res, (err) => {
        assert.fail(`Controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.ok(responseBody.data);

      const stats = responseBody.data;
      assert.equal(stats.playerId, 'usr-stats-1');
      assert.equal(stats.totalPoints, 1200);
      assert.equal(stats.seasonPoints, 400);
      assert.equal(stats.claimsCount, 8);
      assert.equal(stats.currentStreakDays, 4);
      assert.equal(stats.weeklyRank, 1);
      assert.equal(stats.allTimeRank, 1);
      assert.equal(stats.rank, 1);
      assert.equal(stats.tier, 'tier2');

      // Verify underlying player scores were not modified
      const p1 = await playerRepo.findById('usr-stats-1');
      assert.equal(p1?.totalPoints, 1200);
      assert.equal(p1?.seasonPoints, 400);
    });
  });

  describe('2. GET /api/v1/me/claims', () => {
    it('should reject unauthenticated request with 401 Unauthorized', () => {
      const req: any = { headers: {} };
      const res: any = {};
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should return only the authenticated user claims ordered newest first', async () => {
      const req: any = {
        user: { id: 'usr-stats-1', email: 'runner1@campus.edu', username: 'campus_legend', role: 'STUDENT' },
        query: {},
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

      await playerController.getMyClaims(req, res, (err) => {
        assert.fail(`Controller error: ${err}`);
      });

      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.ok(Array.isArray(responseBody.data));
      assert.equal(responseBody.data.length, 2);

      // Verify newest claim is first
      assert.equal(responseBody.data[0].id, 'clm-002');
      assert.equal(responseBody.data[0].pointsAwarded, 100);
      assert.equal(responseBody.data[0].spawnCode, 'GYM-02');
      assert.equal(responseBody.data[0].tier, 'tier2');

      assert.equal(responseBody.data[1].id, 'clm-001');
      assert.equal(responseBody.data[1].pointsAwarded, 50);
      assert.equal(responseBody.data[1].spawnCode, 'LIB-01');

      // Verify player 2 claim is NOT present
      const hasPlayer2Claim = responseBody.data.some((c: any) => c.id === 'clm-003');
      assert.equal(hasPlayer2Claim, false);
    });
  });
});
