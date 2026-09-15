import { ILeaderboardRepository, LeaderboardRecord } from '../../../repositories/ILeaderboardRepository';

export class InMemoryLeaderboardRepository implements ILeaderboardRepository {
  private weeklyScores: Map<string, number> = new Map();
  private allTimeScores: Map<string, number> = new Map();
  private sampleLeaderboard: LeaderboardRecord[] = [];

  constructor(initialLeaderboard: LeaderboardRecord[] = []) {
    this.sampleLeaderboard = [...initialLeaderboard];
  }

  async getWeekly(limit = 20, offset = 0): Promise<LeaderboardRecord[]> {
    // Sort deterministically by points DESC, then profile_id (or playerId) ASC
    const sorted = [...this.sampleLeaderboard].sort((a, b) => {
      const ptsA = a.points ?? 0;
      const ptsB = b.points ?? 0;
      if (ptsB !== ptsA) {
        return ptsB - ptsA;
      }
      const idA = a.profile_id || a.playerId;
      const idB = b.profile_id || b.playerId;
      return idA.localeCompare(idB);
    });

    return sorted
      .map((r, index) => ({
        ...r,
        profile_id: r.profile_id || r.playerId,
        points: r.points ?? 0,
        rank: index + 1,
      }))
      .slice(offset, offset + limit);
  }

  async getAllTime(limit = 20, offset = 0): Promise<LeaderboardRecord[]> {
    const sorted = [...this.sampleLeaderboard].sort((a, b) => {
      const ptsA = a.points ?? 0;
      const ptsB = b.points ?? 0;
      if (ptsB !== ptsA) {
        return ptsB - ptsA;
      }
      const idA = a.profile_id || a.playerId;
      const idB = b.profile_id || b.playerId;
      return idA.localeCompare(idB);
    });

    return sorted
      .map((r, index) => ({
        ...r,
        profile_id: r.profile_id || r.playerId,
        points: r.points ?? 0,
        rank: index + 1,
      }))
      .slice(offset, offset + limit);
  }

  async getPlayerWeeklyRank(playerId: string): Promise<number | null> {
    const target = this.sampleLeaderboard.find(
      (p) => (p.profile_id && p.profile_id === playerId) || p.playerId === playerId
    );
    if (!target) return null;

    const targetPoints = target.points ?? 0;
    const targetId = target.profile_id || target.playerId;

    let higherCount = 0;
    for (const other of this.sampleLeaderboard) {
      const otherId = other.profile_id || other.playerId;
      if (otherId === targetId) continue;
      const otherPoints = other.points ?? 0;
      if (otherPoints > targetPoints) {
        higherCount++;
      } else if (otherPoints === targetPoints && otherId.localeCompare(targetId) < 0) {
        higherCount++;
      }
    }

    return higherCount + 1;
  }

  async getPlayerAllTimeRank(playerId: string): Promise<number | null> {
    const target = this.sampleLeaderboard.find(
      (p) => (p.profile_id && p.profile_id === playerId) || p.playerId === playerId
    );
    if (!target) return null;

    const targetPoints = target.points ?? 0;
    const targetId = target.profile_id || target.playerId;

    let higherCount = 0;
    for (const other of this.sampleLeaderboard) {
      const otherId = other.profile_id || other.playerId;
      if (otherId === targetId) continue;
      const otherPoints = other.points ?? 0;
      if (otherPoints > targetPoints) {
        higherCount++;
      } else if (otherPoints === targetPoints && otherId.localeCompare(targetId) < 0) {
        higherCount++;
      }
    }

    return higherCount + 1;
  }

  async recordScore(playerId: string, points: number): Promise<void> {
    const currentWeekly = this.weeklyScores.get(playerId) || 0;
    this.weeklyScores.set(playerId, currentWeekly + points);

    const currentAllTime = this.allTimeScores.get(playerId) || 0;
    this.allTimeScores.set(playerId, currentAllTime + points);

    const target = this.sampleLeaderboard.find(
      (r) => (r.profile_id && r.profile_id === playerId) || r.playerId === playerId
    );
    if (target) {
      target.points = (target.points ?? 0) + points;
    }
  }

  async resetWeekly(): Promise<void> {
    this.weeklyScores.clear();
    for (const record of this.sampleLeaderboard) {
      record.points = 0;
    }
  }

  async resetWeeklyTx(_tx: import('../../../repositories/ITransactionManager').ITransactionContext): Promise<void> {
    await this.resetWeekly();
  }
}

