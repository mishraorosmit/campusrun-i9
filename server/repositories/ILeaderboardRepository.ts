import { SpawnTier, RankChange } from '../domain/types';
import { ITransactionContext } from './ITransactionManager';

export interface LeaderboardRecord {
  rank: number;
  profile_id?: string;
  playerId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  points: number;
  claimsCount: number;
  tier: SpawnTier;
  rankChange: RankChange;
}

export interface ILeaderboardRepository {
  getWeekly(limit?: number, offset?: number): Promise<LeaderboardRecord[]>;
  getAllTime(limit?: number, offset?: number): Promise<LeaderboardRecord[]>;
  getPlayerWeeklyRank(playerId: string): Promise<number | null>;
  getPlayerAllTimeRank(playerId: string): Promise<number | null>;
  recordScore(playerId: string, points: number): Promise<void>;
  resetWeekly(): Promise<void>;
  resetWeeklyTx?(tx: ITransactionContext): Promise<void>;
}


