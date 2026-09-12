import { ILeaderboardRepository, LeaderboardRecord } from '../../../repositories/ILeaderboardRepository';

export class InMemoryLeaderboardRepository implements ILeaderboardRepository {
  private weeklyScores: Map<string, number> = new Map();
  private allTimeScores: Map<string, number> = new Map();
  private sampleLeaderboard: LeaderboardRecord[] = [];

  constructor(initialLeaderboard: LeaderboardRecord[] = []) {
    this.sampleLeaderboard = [...initialLeaderboard];
  }

  async getWeekly(limit = 20): Promise<LeaderboardRecord[]> {
    return this.sampleLeaderboard.slice(0, limit);
  }

  async getAllTime(limit = 20): Promise<LeaderboardRecord[]> {
    return this.sampleLeaderboard.slice(0, limit);
  }

  async recordScore(playerId: string, points: number): Promise<void> {
    const currentWeekly = this.weeklyScores.get(playerId) || 0;
    this.weeklyScores.set(playerId, currentWeekly + points);

    const currentAllTime = this.allTimeScores.get(playerId) || 0;
    this.allTimeScores.set(playerId, currentAllTime + points);
  }

  async resetWeekly(): Promise<void> {
    this.weeklyScores.clear();
  }
}
