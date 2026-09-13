import { ILeaderboardRepository, LeaderboardRecord } from '../../../repositories/ILeaderboardRepository';
import { DatabasePool, dbPool } from '../../database/pool';
import { SpawnTier, RankChange } from '../../../domain/types';

export class PostgresLeaderboardRepository implements ILeaderboardRepository {
  constructor(private readonly pool: DatabasePool = dbPool) {}

  public async getWeekly(limit = 20): Promise<LeaderboardRecord[]> {
    const res = await this.pool.query<any>(
      `SELECT 
        p.user_id as "playerId",
        p.username,
        p.avatar_url as "avatarUrl",
        p.season_points as points,
        p.claims_count as "claimsCount",
        RANK() OVER (ORDER BY p.season_points DESC, p.updated_at ASC)::int as rank
       FROM profiles p
       JOIN users u ON p.user_id = u.id
       WHERE u.status = 'active'
       ORDER BY p.season_points DESC, p.updated_at ASC
       LIMIT $1;`,
      [limit]
    );

    return res.rows.map((r) => this.mapRowToLeaderboardRecord(r));
  }

  public async getAllTime(limit = 20): Promise<LeaderboardRecord[]> {
    const res = await this.pool.query<any>(
      `SELECT 
        p.user_id as "playerId",
        p.username,
        p.avatar_url as "avatarUrl",
        p.total_points as points,
        p.claims_count as "claimsCount",
        RANK() OVER (ORDER BY p.total_points DESC, p.updated_at ASC)::int as rank
       FROM profiles p
       JOIN users u ON p.user_id = u.id
       WHERE u.status = 'active'
       ORDER BY p.total_points DESC, p.updated_at ASC
       LIMIT $1;`,
      [limit]
    );

    return res.rows.map((r) => this.mapRowToLeaderboardRecord(r));
  }

  public async recordScore(playerId: string, points: number): Promise<void> {
    await this.pool.query(
      `UPDATE profiles
       SET season_points = season_points + $2,
           total_points = total_points + $2,
           claims_count = claims_count + 1,
           last_active_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $1;`,
      [playerId, points]
    );
  }

  public async resetWeekly(): Promise<void> {
    await this.pool.query(
      `UPDATE profiles
       SET season_points = 0,
           updated_at = NOW();`
    );
  }

  private mapRowToLeaderboardRecord(row: any): LeaderboardRecord {
    const points = Number(row.points) || 0;
    let tier: SpawnTier = 'tier1';
    if (points >= 1000) tier = 'tier4';
    else if (points >= 500) tier = 'tier3';
    else if (points >= 200) tier = 'tier2';

    return {
      rank: Number(row.rank) || 1,
      playerId: row.playerId,
      username: row.username,
      avatarUrl: row.avatarUrl || undefined,
      points,
      claimsCount: Number(row.claimsCount) || 0,
      tier,
      rankChange: 'same' as RankChange,
    };
  }
}
