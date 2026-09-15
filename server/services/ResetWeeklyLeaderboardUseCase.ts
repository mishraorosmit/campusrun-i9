import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';

export interface ResetWeeklyResultDTO {
  success: boolean;
  message: string;
  resetAt: string;
}

export class ResetWeeklyLeaderboardUseCase {
  constructor(private readonly leaderboardRepo: ILeaderboardRepository) {}

  /**
   * Resets all weekly/season points to 0 while strictly preserving all-time points (total_points).
   * Does not delete profiles, claims, users, or historical scoring data.
   */
  public async execute(): Promise<ResetWeeklyResultDTO> {
    await this.leaderboardRepo.resetWeekly();

    return {
      success: true,
      message: 'Weekly leaderboard reset successfully. All season_points have been reset to 0 while preserving total_points.',
      resetAt: new Date().toISOString(),
    };
  }
}
