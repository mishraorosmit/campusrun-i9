import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';
import { PlayerStatsDTO } from './dtos';
import { NotFoundError } from '../errors';

export class GetPlayerStatsUseCase {
  constructor(
    private readonly playerRepo: IPlayerRepository,
    private readonly leaderboardRepo?: ILeaderboardRepository
  ) {}

  public async execute(playerId: string): Promise<PlayerStatsDTO> {
    const player = await this.playerRepo.findById(playerId);
    if (!player) {
      throw new NotFoundError(`Player with id "${playerId}" not found`);
    }

    let weeklyRank: number | null = null;
    let allTimeRank: number | null = null;

    if (this.leaderboardRepo) {
      try {
        weeklyRank = await this.leaderboardRepo.getPlayerWeeklyRank(playerId);
      } catch {
        // Fallback to null if rank query cannot resolve
      }

      try {
        allTimeRank = await this.leaderboardRepo.getPlayerAllTimeRank(playerId);
      } catch {
        // Fallback to null if rank query cannot resolve
      }
    }

    return {
      playerId: player.id,
      totalPoints: player.totalPoints,
      seasonPoints: player.seasonPoints,
      claimsCount: player.claimsCount,
      currentStreakDays: player.currentStreakDays,
      rank: weeklyRank ?? player.props.rank ?? null,
      weeklyRank: weeklyRank ?? null,
      allTimeRank: allTimeRank ?? null,
      tier: player.props.tier,
    };
  }
}
