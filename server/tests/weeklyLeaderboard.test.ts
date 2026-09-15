import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GetLeaderboardUseCase } from '../services/GetLeaderboardUseCase';
import { LeaderboardController } from '../controllers/LeaderboardController';
import { PostgresLeaderboardRepository } from '../infrastructure/repositories/postgres/PostgresLeaderboardRepository';
import { InMemoryLeaderboardRepository } from '../infrastructure/repositories/inmemory/InMemoryLeaderboardRepository';
import { ILeaderboardRepository, LeaderboardRecord } from '../repositories/ILeaderboardRepository';

describe('Weekly Leaderboard Query & Use Case', () => {
  let sampleRecords: LeaderboardRecord[];
  let inMemoryRepo: InMemoryLeaderboardRepository;
  let useCase: GetLeaderboardUseCase;
  let controller: LeaderboardController;

  beforeEach(() => {
    // 5 players with various scores and tie conditions
    sampleRecords = [
      {
        rank: 0,
        profile_id: 'usr_b_2222',
        playerId: 'usr_b_2222',
        username: 'runner_beta',
        displayName: 'Beta Runner',
        avatarUrl: 'https://avatar.com/beta.png',
        points: 500,
        claimsCount: 5,
        tier: 'tier2',
        rankChange: 'same',
      },
      {
        rank: 0,
        profile_id: 'usr_a_1111',
        playerId: 'usr_a_1111',
        username: 'runner_alpha',
        displayName: 'Alpha Runner',
        avatarUrl: 'https://avatar.com/alpha.png',
        points: 500, // Tied with Beta, but 'usr_a_1111' < 'usr_b_2222'
        claimsCount: 6,
        tier: 'tier2',
        rankChange: 'up',
      },
      {
        rank: 0,
        profile_id: 'usr_c_3333',
        playerId: 'usr_c_3333',
        username: 'runner_gamma',
        displayName: 'Gamma Champion',
        avatarUrl: 'https://avatar.com/gamma.png',
        points: 1200, // 1st place
        claimsCount: 12,
        tier: 'tier4',
        rankChange: 'same',
      },
      {
        rank: 0,
        profile_id: 'usr_d_4444',
        playerId: 'usr_d_4444',
        username: 'runner_delta',
        displayName: 'Delta Novice',
        avatarUrl: 'https://avatar.com/delta.png',
        points: 150,
        claimsCount: 2,
        tier: 'tier1',
        rankChange: 'down',
      },
      {
        rank: 0,
        profile_id: 'usr_e_5555',
        playerId: 'usr_e_5555',
        username: 'runner_epsilon',
        displayName: 'Epsilon Explorer',
        avatarUrl: 'https://avatar.com/epsilon.png',
        points: 50,
        claimsCount: 1,
        tier: 'tier1',
        rankChange: 'same',
      },
    ];

    inMemoryRepo = new InMemoryLeaderboardRepository(sampleRecords);
    useCase = new GetLeaderboardUseCase(inMemoryRepo);
    controller = new LeaderboardController(useCase);
  });

  it('1. should order weekly leaderboard by season_points DESC and break ties by profile_id ASC', async () => {
    const leaderboard = await useCase.execute('weekly', 10, 0);

    assert.equal(leaderboard.length, 5);

    // Rank 1: Gamma (1200 pts)
    assert.equal(leaderboard[0].rank, 1);
    assert.equal(leaderboard[0].profile_id, 'usr_c_3333');
    assert.equal(leaderboard[0].points, 1200);

    // Rank 2: Alpha (500 pts, profile_id 'usr_a_1111' wins tie over 'usr_b_2222')
    assert.equal(leaderboard[1].rank, 2);
    assert.equal(leaderboard[1].profile_id, 'usr_a_1111');
    assert.equal(leaderboard[1].username, 'runner_alpha');
    assert.equal(leaderboard[1].displayName, 'Alpha Runner');
    assert.equal(leaderboard[1].points, 500);

    // Rank 3: Beta (500 pts, profile_id 'usr_b_2222')
    assert.equal(leaderboard[2].rank, 3);
    assert.equal(leaderboard[2].profile_id, 'usr_b_2222');
    assert.equal(leaderboard[2].points, 500);

    // Rank 4: Delta (150 pts)
    assert.equal(leaderboard[3].rank, 4);
    assert.equal(leaderboard[3].profile_id, 'usr_d_4444');
    assert.equal(leaderboard[3].points, 150);

    // Rank 5: Epsilon (50 pts)
    assert.equal(leaderboard[4].rank, 5);
    assert.equal(leaderboard[4].profile_id, 'usr_e_5555');
    assert.equal(leaderboard[4].points, 50);
  });

  it('2. should support pagination with limit and offset while preserving global rank calculation', async () => {
    // Page 1: limit 2, offset 0
    const page1 = await useCase.execute('weekly', 2, 0);
    assert.equal(page1.length, 2);
    assert.equal(page1[0].rank, 1);
    assert.equal(page1[0].profile_id, 'usr_c_3333');
    assert.equal(page1[1].rank, 2);
    assert.equal(page1[1].profile_id, 'usr_a_1111');

    // Page 2: limit 2, offset 2
    const page2 = await useCase.execute('weekly', 2, 2);
    assert.equal(page2.length, 2);
    assert.equal(page2[0].rank, 3);
    assert.equal(page2[0].profile_id, 'usr_b_2222');
    assert.equal(page2[1].rank, 4);
    assert.equal(page2[1].profile_id, 'usr_d_4444');

    // Page 3: limit 2, offset 4
    const page3 = await useCase.execute('weekly', 2, 4);
    assert.equal(page3.length, 1);
    assert.equal(page3[0].rank, 5);
    assert.equal(page3[0].profile_id, 'usr_e_5555');
  });

  it('3. should return required fields in controller response (profile_id, points, rank, username, displayName)', async () => {
    let responseStatus = 200;
    let responseBody: any = null;

    const req: any = {
      query: {
        limit: '3',
        offset: '1',
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

    await controller.getWeeklyLeaderboard(req, res, next);

    assert.equal(responseStatus, 200);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.data.length, 3);

    // First item on offset 1 is rank 2 (Alpha)
    const firstItem = responseBody.data[0];
    assert.equal(firstItem.rank, 2);
    assert.equal(firstItem.profile_id, 'usr_a_1111');
    assert.equal(firstItem.username, 'runner_alpha');
    assert.equal(firstItem.displayName, 'Alpha Runner');
    assert.equal(firstItem.points, 500);
  });
});

describe('PostgresLeaderboardRepository Weekly Query Construction', () => {
  it('should construct SQL query with ROW_NUMBER() OVER (ORDER BY season_points DESC, profile_id ASC), LIMIT, and OFFSET', async () => {
    let capturedQuery = '';
    let capturedParams: any[] = [];

    const mockPool = {
      query: async (text: string, params: any[]) => {
        capturedQuery = text;
        capturedParams = params;
        return {
          rows: [
            {
              rank: 1,
              profile_id: 'usr_top_1',
              username: 'top_runner',
              displayName: 'Top Runner',
              avatarUrl: null,
              points: 1000,
              claimsCount: 10,
            },
          ],
          rowCount: 1,
        };
      },
    } as any;

    const repo = new PostgresLeaderboardRepository(mockPool);
    const result = await repo.getWeekly(15, 30);

    // Verify SQL contents
    assert(capturedQuery.includes('ROW_NUMBER() OVER (ORDER BY season_points DESC,'), 'Must use ROW_NUMBER() for season_points ranking');
    assert(capturedQuery.includes('profile_id ASC'), 'Must order by profile_id ASC for tie-breaking');
    assert(capturedQuery.includes('LIMIT $1 OFFSET $2'), 'Must parameterize LIMIT and OFFSET');
    assert.equal(capturedParams[0], 15);
    assert.equal(capturedParams[1], 30);

    // Verify mapped entity fields
    assert.equal(result.length, 1);
    assert.equal(result[0].rank, 1);
    assert.equal(result[0].profile_id, 'usr_top_1');
    assert.equal(result[0].username, 'top_runner');
    assert.equal(result[0].displayName, 'Top Runner');
    assert.equal(result[0].points, 1000);
  });
});
