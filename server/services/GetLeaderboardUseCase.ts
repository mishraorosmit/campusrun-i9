import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';
import { LeaderboardEntryDTO } from './dtos';

export interface PlayerRankResultDTO {
  playerId: string;
  rank: number | null;
}

export interface PlayerAllRanksDTO {
  playerId: string;
  weeklyRank: number | null;
  allTimeRank: number | null;
}

export class GetLeaderboardUseCase {
  constructor(private readonly leaderboardRepo: ILeaderboardRepository) {}

  public async execute(
    period: 'weekly' | 'all-time' = 'weekly',
    limit = 20,
    offset = 0
  ): Promise<LeaderboardEntryDTO[]> {
    const records =
      period === 'all-time'
        ? await this.leaderboardRepo.getAllTime(limit, offset)
        : await this.leaderboardRepo.getWeekly(limit, offset);

    return records.map((r) => ({
      rank: r.rank,
      profile_id: r.profile_id || r.playerId,
      playerId: r.playerId || r.profile_id || '',
      username: r.username,
      displayName: r.displayName || r.username,
      avatarUrl: r.avatarUrl,
      points: r.points,
      claimsCount: r.claimsCount,
      tier: r.tier,
      rankChange: r.rankChange,
    }));
  }

  public async getPlayerWeeklyRank(playerId: string): Promise<PlayerRankResultDTO> {
    const rank = await this.leaderboardRepo.getPlayerWeeklyRank(playerId);
    return {
      playerId,
      rank,
    };
  }

  public async getPlayerAllTimeRank(playerId: string): Promise<PlayerRankResultDTO> {
    const rank = await this.leaderboardRepo.getPlayerAllTimeRank(playerId);
    return {
      playerId,
      rank,
    };
  }

  public async getPlayerRanks(playerId: string): Promise<PlayerAllRanksDTO> {
    const [weeklyRank, allTimeRank] = await Promise.all([
      this.leaderboardRepo.getPlayerWeeklyRank(playerId),
      this.leaderboardRepo.getPlayerAllTimeRank(playerId),
    ]);

    return {
      playerId,
      weeklyRank,
      allTimeRank,
    };
  }
}
