import { SpawnTier, RankChange } from '../domain/types';

export interface LeaderboardRecord {
  rank: number;
  playerId: string;
  username: string;
  avatarUrl?: string;
  points: number;
  claimsCount: number;
  tier: SpawnTier;
  rankChange: RankChange;
}

export interface ILeaderboardRepository {
  getWeekly(limit?: number): Promise<LeaderboardRecord[]>;
  getAllTime(limit?: number): Promise<LeaderboardRecord[]>;
  recordScore(playerId: string, points: number): Promise<void>;
  resetWeekly(): Promise<void>;
}
