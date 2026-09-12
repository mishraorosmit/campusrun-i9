import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GetLeaderboardUseCase } from '../services/GetLeaderboardUseCase';
import { LeaderboardController } from '../controllers/LeaderboardController';
import { PostgresLeaderboardRepository } from '../infrastructure/repositories/postgres/PostgresLeaderboardRepository';
import { InMemoryLeaderboardRepository } from '../infrastructure/repositories/inmemory/InMemoryLeaderboardRepository';
import { LeaderboardRecord } from '../repositories/ILeaderboardRepository';

describe('All-Time Leaderboard Query & Use Case', () => {
  let sampleRecords: LeaderboardRecord[];
  let inMemoryRepo: InMemoryLeaderboardRepository;
  let useCase: GetLeaderboardUseCase;
  let controller: LeaderboardController;

  beforeEach(() => {
    // 5 players with various all-time scores and tie conditions
    sampleRecords = [
      {
        rank: 0,
        profile_id: 'usr_b_200',
        playerId: 'usr_b_200',
        username: 'runner_veteran_b',
        displayName: 'Veteran B',
        avatarUrl: 'https://avatar.com/vet_b.png',
        points: 2500,
        claimsCount: 25,
        tier: 'tier3',
        rankChange: 'same',
      },
      {
        rank: 0,
        profile_id: 'usr_a_100',
        playerId: 'usr_a_100',
        username: 'runner_veteran_a',
        displayName: 'Veteran A',
        avatarUrl: 'https://avatar.com/vet_a.png',
        points: 2500, // Tied with Veteran B, but 'usr_a_100' < 'usr_b_200'
        claimsCount: 28,
        tier: 'tier3',
        rankChange: 'up',
      },
      {
        rank: 0,
        profile_id: 'usr_c_300',
        playerId: 'usr_c_300',
        username: 'runner_legend',
        displayName: 'Campus Legend',
        avatarUrl: 'https://avatar.com/legend.png',
        points: 8500, // 1st place all-time
        claimsCount: 95,
        tier: 'tier4',
        rankChange: 'same',
      },
      {
        rank: 0,
        profile_id: 'usr_d_400',
        playerId: 'usr_d_400',
        username: 'runner_intermediate',
        displayName: 'Intermediate Runner',
        avatarUrl: 'https://avatar.com/inter.png',
        points: 900,
        claimsCount: 9,
        tier: 'tier2',
        rankChange: 'down',
      },
      {
        rank: 0,
        profile_id: 'usr_e_500',
        playerId: 'usr_e_500',
        username: 'runner_rookie',
        displayName: 'Freshman Rookie',
        avatarUrl: 'https://avatar.com/rookie.png',
        points: 150,
        claimsCount: 2,
        tier: 'tier1',
        rankChange: 'same',
      },
    ];

    inMemoryRepo = new InMemoryLeaderboardRepository(sampleRecords);
    useCase = new GetLeaderboardUseCase(inMemoryRepo);
    controller = new LeaderboardController(useCase);
  });

  it('1. should order all-time leaderboard by total_points DESC and break ties by profile_id ASC', async () => {
    const leaderboard = await useCase.execute('all-time', 10, 0);

    assert.equal(leaderboard.length, 5);

    // Rank 1: Campus Legend (8500 pts)
    assert.equal(leaderboard[0].rank, 1);
    assert.equal(leaderboard[0].profile_id, 'usr_c_300');
    assert.equal(leaderboard[0].points, 8500);

    // Rank 2: Veteran A (2500 pts, profile_id 'usr_a_100' wins tie over 'usr_b_200')
    assert.equal(leaderboard[1].rank, 2);
    assert.equal(leaderboard[1].profile_id, 'usr_a_100');
    assert.equal(leaderboard[1].username, 'runner_veteran_a');
    assert.equal(leaderboard[1].displayName, 'Veteran A');
    assert.equal(leaderboard[1].points, 2500);

    // Rank 3: Veteran B (2500 pts, profile_id 'usr_b_200')
    assert.equal(leaderboard[2].rank, 3);
    assert.equal(leaderboard[2].profile_id, 'usr_b_200');
    assert.equal(leaderboard[2].points, 2500);

    // Rank 4: Intermediate (900 pts)
    assert.equal(leaderboard[3].rank, 4);
    assert.equal(leaderboard[3].profile_id, 'usr_d_400');
    assert.equal(leaderboard[3].points, 900);

    // Rank 5: Rookie (150 pts)
    assert.equal(leaderboard[4].rank, 5);
    assert.equal(leaderboard[4].profile_id, 'usr_e_500');
    assert.equal(leaderboard[4].points, 150);
  });

  it('2. should support pagination with limit and offset while preserving global rank calculation', async () => {
    // Page 1: limit 2, offset 0
    const page1 = await useCase.execute('all-time', 2, 0);
    assert.equal(page1.length, 2);
    assert.equal(page1[0].rank, 1);
    assert.equal(page1[0].profile_id, 'usr_c_300');
    assert.equal(page1[1].rank, 2);
    assert.equal(page1[1].profile_id, 'usr_a_100');

    // Page 2: limit 2, offset 2
    const page2 = await useCase.execute('all-time', 2, 2);
    assert.equal(page2.length, 2);
    assert.equal(page2[0].rank, 3);
    assert.equal(page2[0].profile_id, 'usr_b_200');
    assert.equal(page2[1].rank, 4);
    assert.equal(page2[1].profile_id, 'usr_d_400');

    // Page 3: limit 2, offset 4
    const page3 = await useCase.execute('all-time', 2, 4);
    assert.equal(page3.length, 1);
    assert.equal(page3[0].rank, 5);
    assert.equal(page3[0].profile_id, 'usr_e_500');
  });

  it('3. should return required fields in all-time controller response (profile_id, points, rank, username, displayName)', async () => {
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

    await controller.getAllTimeLeaderboard(req, res, next);

    assert.equal(responseStatus, 200);
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.data.length, 3);

    // First item on offset 1 is rank 2 (Veteran A)
    const firstItem = responseBody.data[0];
    assert.equal(firstItem.rank, 2);
    assert.equal(firstItem.profile_id, 'usr_a_100');
    assert.equal(firstItem.username, 'runner_veteran_a');
    assert.equal(firstItem.displayName, 'Veteran A');
    assert.equal(firstItem.points, 2500);
  });
});

describe('PostgresLeaderboardRepository All-Time Query Construction', () => {
  it('should construct SQL query with ROW_NUMBER() OVER (ORDER BY total_points DESC, profile_id ASC), LIMIT, and OFFSET', async () => {
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
              profile_id: 'usr_alltime_top',
              username: 'hall_of_famer',
              displayName: 'Hall of Famer',
              avatarUrl: null,
              points: 50000,
              claimsCount: 500,
            },
          ],
          rowCount: 1,
        };
      },
    } as any;

    const repo = new PostgresLeaderboardRepository(mockPool);
    const result = await repo.getAllTime(25, 50);

    // Verify SQL contents
    assert(capturedQuery.includes('ROW_NUMBER() OVER (ORDER BY total_points DESC,'), 'Must use ROW_NUMBER() for total_points ranking');
    assert(capturedQuery.includes('profile_id ASC'), 'Must order by profile_id ASC for tie-breaking');
    assert(capturedQuery.includes('LIMIT $1 OFFSET $2'), 'Must parameterize LIMIT and OFFSET');
    assert.equal(capturedParams[0], 25);
    assert.equal(capturedParams[1], 50);

    // Verify mapped entity fields
    assert.equal(result.length, 1);
    assert.equal(result[0].rank, 1);
    assert.equal(result[0].profile_id, 'usr_alltime_top');
    assert.equal(result[0].username, 'hall_of_famer');
    assert.equal(result[0].displayName, 'Hall of Famer');
    assert.equal(result[0].points, 50000);
  });
});
