import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';
import { LeaderboardEntryDTO } from './dtos';

export class GetLeaderboardUseCase {
  constructor(private readonly leaderboardRepo: ILeaderboardRepository) {}

  public async execute(period: 'weekly' | 'all-time' = 'weekly', limit = 20): Promise<LeaderboardEntryDTO[]> {
    const records =
      period === 'all-time'
        ? await this.leaderboardRepo.getAllTime(limit)
        : await this.leaderboardRepo.getWeekly(limit);

    return records.map((r) => ({
      rank: r.rank,
      playerId: r.playerId,
      username: r.username,
      avatarUrl: r.avatarUrl,
      points: r.points,
      claimsCount: r.claimsCount,
      tier: r.tier,
      rankChange: r.rankChange,
    }));
  }
}
