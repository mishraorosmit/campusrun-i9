import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GetLeaderboardUseCase } from '../services/GetLeaderboardUseCase';
import { LeaderboardController } from '../controllers/LeaderboardController';
import { PostgresLeaderboardRepository } from '../infrastructure/repositories/postgres/PostgresLeaderboardRepository';
import { InMemoryLeaderboardRepository } from '../infrastructure/repositories/inmemory/InMemoryLeaderboardRepository';
import { LeaderboardRecord } from '../repositories/ILeaderboardRepository';

describe('Current Player Rank Queries', () => {
  let samplePlayers: LeaderboardRecord[];
  let inMemoryRepo: InMemoryLeaderboardRepository;
  let useCase: GetLeaderboardUseCase;
  let controller: LeaderboardController;

  beforeEach(() => {
    // 5 players with tied scores, 0 scores, and higher scores
    samplePlayers = [
      {
        rank: 0,
        profile_id: 'usr_c_300',
        playerId: 'usr_c_300',
        username: 'champion',
        points: 1500,
        claimsCount: 15,
        tier: 'tier4',
        rankChange: 'same',
      },
      {
        rank: 0,
        profile_id: 'usr_a_100',
        playerId: 'usr_a_100',
        username: 'tied_player_a',
        points: 500, // Tied with B, but 'usr_a_100' < 'usr_b_200'
        claimsCount: 5,
        tier: 'tier2',
        rankChange: 'same',
      },
      {
        rank: 0,
        profile_id: 'usr_b_200',
        playerId: 'usr_b_200',
        username: 'tied_player_b',
        points: 500, // Tied with A, but 'usr_b_200' > 'usr_a_100'
        claimsCount: 5,
        tier: 'tier2',
        rankChange: 'same',
      },
      {
        rank: 0,
        profile_id: 'usr_d_400',
        playerId: 'usr_d_400',
        username: 'zero_point_runner_d',
        points: 0, // Tied at 0 points with E, but 'usr_d_400' < 'usr_e_500'
        claimsCount: 0,
        tier: 'tier1',
        rankChange: 'same',
      },
      {
        rank: 0,
        profile_id: 'usr_e_500',
        playerId: 'usr_e_500',
        username: 'zero_point_runner_e',
        points: 0, // Tied at 0 points with D
        claimsCount: 0,
        tier: 'tier1',
        rankChange: 'same',
      },
    ];

    inMemoryRepo = new InMemoryLeaderboardRepository(samplePlayers);
    useCase = new GetLeaderboardUseCase(inMemoryRepo);
    controller = new LeaderboardController(useCase);
  });

  it('1. should calculate weekly rank accurately for top player', async () => {
    const res = await useCase.getPlayerWeeklyRank('usr_c_300');
    assert.equal(res.rank, 1, 'Highest scoring player must be rank 1');
  });

  it('2. should deterministically break tie for tied players', async () => {
    const rankA = await useCase.getPlayerWeeklyRank('usr_a_100');
    const rankB = await useCase.getPlayerWeeklyRank('usr_b_200');

    // usr_a_100 < usr_b_200, so usr_a_100 is rank 2 and usr_b_200 is rank 3
    assert.equal(rankA.rank, 2, 'Player A has lower profile_id so wins tie (rank 2)');
    assert.equal(rankB.rank, 3, 'Player B has higher profile_id so loses tie (rank 3)');
  });

  it('3. should calculate rank accurately for players with zero points', async () => {
    const rankD = await useCase.getPlayerWeeklyRank('usr_d_400');
    const rankE = await useCase.getPlayerWeeklyRank('usr_e_500');

    // Higher points: C (1500), A (500), B (500) -> 3 players
    // D has 0 points, profile_id 'usr_d_400' < 'usr_e_500' -> rank 4
    // E has 0 points, profile_id 'usr_e_500' > 'usr_d_400' -> rank 5
    assert.equal(rankD.rank, 4, 'Zero point player D should be rank 4');
    assert.equal(rankE.rank, 5, 'Zero point player E should be rank 5');
  });

  it('4. should return null for non-existent player', async () => {
    const res = await useCase.getPlayerWeeklyRank('usr_non_existent');
    assert.equal(res.rank, null);
  });

  it('5. should fetch both weekly and all-time ranks via getPlayerRanks and controller endpoint', async () => {
    let responseStatus = 200;
    let responseBody: any = null;

    const req: any = {
      params: {
        playerId: 'usr_b_200',
      },
    };

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

    await controller.getPlayerRank(req, res, next);

    assert.equal(responseStatus, 200);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.data.playerId, 'usr_b_200');
    assert.equal(responseBody.data.weeklyRank, 3);
    assert.equal(responseBody.data.allTimeRank, 3);
  });
});

describe('PostgresLeaderboardRepository Player Rank SQL Query Construction', () => {
  it('should construct SQL query calculating rank using higher points, lower profile_id tie-breaker, and COALESCE', async () => {
    let capturedQuery = '';
    let capturedParams: any[] = [];

    const mockPool = {
      query: async (text: string, params: any[]) => {
        capturedQuery = text;
        capturedParams = params;
        return {
          rows: [{ rank: 7 }],
          rowCount: 1,
        };
      },
    } as any;

    const repo = new PostgresLeaderboardRepository(mockPool);

    // 1. Weekly rank query
    const weeklyRank = await repo.getPlayerWeeklyRank('player_uuid_123');
    assert.equal(weeklyRank, 7);
    assert.equal(capturedParams[0], 'player_uuid_123');
    assert(capturedQuery.includes('COALESCE(other.season_points, 0) > COALESCE(target.season_points, 0)'), 'Must compare points strictly greater');
    assert(capturedQuery.includes('AND COALESCE(other.profile_id, other.user_id)::text < COALESCE(target.profile_id, target.user_id)::text'), 'Must compare lower profile_id on ties');
    assert(capturedQuery.includes('COUNT(*)::int + 1'), 'Must add 1 to count');

    // 2. All-time rank query
    const allTimeRank = await repo.getPlayerAllTimeRank('player_uuid_123');
    assert.equal(allTimeRank, 7);
    assert(capturedQuery.includes('COALESCE(other.total_points, 0) > COALESCE(target.total_points, 0)'), 'Must compare all-time points');
  });
});
