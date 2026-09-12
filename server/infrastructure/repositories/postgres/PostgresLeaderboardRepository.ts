import { Pool } from 'pg';
import { ILeaderboardRepository, LeaderboardRecord } from '../../../repositories/ILeaderboardRepository';
import { SpawnTier } from '../../../domain/types';

export class PostgresLeaderboardRepository implements ILeaderboardRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Retrieves the weekly leaderboard ordered by season_points DESC, profile_id ASC
   * utilizing ROW_NUMBER() OVER (ORDER BY season_points DESC, profile_id ASC) for exact ranking across pagination.
   */
  async getWeekly(limit = 20, offset = 0): Promise<LeaderboardRecord[]> {
    const res = await this.pool.query<any>(`
      SELECT 
        sub.rank,
        sub.profile_id,
        sub.profile_id AS "playerId",
        sub.username,
        sub.display_name AS "displayName",
        sub.avatar_url AS "avatarUrl",
        sub.points,
        sub.claims_count AS "claimsCount"
      FROM (
        SELECT 
          profile_id::text AS profile_id,
          username,
          display_name,
          avatar_url,
          season_points AS points,
          claims_count,
          ROW_NUMBER() OVER (ORDER BY season_points DESC, profile_id ASC)::int AS rank
        FROM profiles
      ) sub
      ORDER BY sub.rank ASC
      LIMIT $1 OFFSET $2;
    `, [limit, offset]);

    return res.rows.map((row) => ({
      rank: Number(row.rank),
      profile_id: row.profile_id,
      playerId: row.profile_id,
      username: row.username || 'Anonymous Runner',
      displayName: row.displayName || row.username,
      avatarUrl: row.avatarUrl || undefined,
      points: Number(row.points) || 0,
      claimsCount: Number(row.claimsCount) || 0,
      tier: 'tier1' as SpawnTier,
      rankChange: 'same' as const,
    }));
  }

  /**
   * Retrieves the all-time leaderboard ordered by total_points DESC, profile_id ASC.
   */
  async getAllTime(limit = 20, offset = 0): Promise<LeaderboardRecord[]> {
    const res = await this.pool.query<any>(`
      SELECT 
        sub.rank,
        sub.profile_id,
        sub.profile_id AS "playerId",
        sub.username,
        sub.display_name AS "displayName",
        sub.avatar_url AS "avatarUrl",
        sub.points,
        sub.claims_count AS "claimsCount"
      FROM (
        SELECT 
          profile_id::text AS profile_id,
          username,
          display_name,
          avatar_url,
          total_points AS points,
          claims_count,
          ROW_NUMBER() OVER (ORDER BY total_points DESC, profile_id ASC)::int AS rank
        FROM profiles
      ) sub
      ORDER BY sub.rank ASC
      LIMIT $1 OFFSET $2;
    `, [limit, offset]);

    return res.rows.map((row) => ({
      rank: Number(row.rank),
      profile_id: row.profile_id,
      playerId: row.profile_id,
      username: row.username || 'Anonymous Runner',
      displayName: row.displayName || row.username,
      avatarUrl: row.avatarUrl || undefined,
      points: Number(row.points) || 0,
      claimsCount: Number(row.claimsCount) || 0,
      tier: 'tier1' as SpawnTier,
      rankChange: 'same' as const,
    }));
  }

  /**
   * Calculates the current player's deterministic weekly rank based on season_points DESC, profile_id ASC.
   * Rank = (players with higher season_points) + (players with equal points but lower profile_id) + 1.
   * Treats null points safely as 0.
   */
  async getPlayerWeeklyRank(playerId: string): Promise<number | null> {
    const res = await this.pool.query<{ rank: number }>(`
      SELECT 
        (
          SELECT COUNT(*)::int + 1
          FROM profiles other
          WHERE 
            COALESCE(other.season_points, 0) > COALESCE(target.season_points, 0)
            OR (
              COALESCE(other.season_points, 0) = COALESCE(target.season_points, 0)
              AND COALESCE(other.profile_id, other.user_id)::text < COALESCE(target.profile_id, target.user_id)::text
            )
        ) AS rank
      FROM profiles target
      WHERE target.user_id::text = $1 OR target.profile_id::text = $1;
    `, [playerId]);

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return Number(res.rows[0].rank);
  }

  /**
   * Calculates the current player's deterministic all-time rank based on total_points DESC, profile_id ASC.
   * Rank = (players with higher total_points) + (players with equal points but lower profile_id) + 1.
   * Treats null points safely as 0.
   */
  async getPlayerAllTimeRank(playerId: string): Promise<number | null> {
    const res = await this.pool.query<{ rank: number }>(`
      SELECT 
        (
          SELECT COUNT(*)::int + 1
          FROM profiles other
          WHERE 
            COALESCE(other.total_points, 0) > COALESCE(target.total_points, 0)
            OR (
              COALESCE(other.total_points, 0) = COALESCE(target.total_points, 0)
              AND COALESCE(other.profile_id, other.user_id)::text < COALESCE(target.profile_id, target.user_id)::text
            )
        ) AS rank
      FROM profiles target
      WHERE target.user_id::text = $1 OR target.profile_id::text = $1;
    `, [playerId]);

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return Number(res.rows[0].rank);
  }

  async recordScore(playerId: string, points: number): Promise<void> {
    await this.pool.query(
      `UPDATE profiles SET season_points = season_points + $1, total_points = total_points + $1 WHERE user_id = $2`,
      [points, playerId]
    );
  }

  async resetWeekly(): Promise<void> {
    await this.pool.query(`UPDATE profiles SET season_points = 0`);
  }

  async resetWeeklyTx(tx: import('../../../repositories/ITransactionManager').ITransactionContext): Promise<void> {
    await tx.query(`UPDATE profiles SET season_points = 0`);
  }
}
