import { IPlayerRepository } from '../../../repositories/IPlayerRepository';
import { Player, PlayerProps } from '../../../domain/entities/Player';
import { DatabasePool, dbPool } from '../../database/pool';
import { transactionManager } from '../../database/transaction';
import { ITransactionContext } from '../../../repositories/ITransactionManager';
import { PlayerRole } from '../../../domain/types';

export class PostgresPlayerRepository implements IPlayerRepository {
  constructor(private readonly pool: any = dbPool.getPool()) {}

  public async findById(id: string): Promise<Player | null> {
    const res = await this.pool.query(
      `SELECT 
        u.id, 
        u.email, 
        u.status, 
        u.created_at as "userCreatedAt",
        p.username, 
        p.display_name, 
        p.avatar_url, 
        p.total_points, 
        p.season_points, 
        p.claims_count, 
        p.current_streak_days, 
        p.longest_streak_days, 
        p.last_streak_claim_at, 
        p.last_active_at, 
        p.created_at as "profileCreatedAt",
        a.role as admin_role
       FROM users u
       JOIN profiles p ON u.id = p.user_id
       LEFT JOIN admins a ON u.id = a.user_id AND a.revoked_at IS NULL
       WHERE u.id = $1;`,
      [id]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToPlayer(res.rows[0]);
  }

  public async findByEmail(email: string): Promise<Player | null> {
    const res = await this.pool.query(
      `SELECT 
        u.id, 
        u.email, 
        u.status, 
        u.created_at as "userCreatedAt",
        p.username, 
        p.display_name, 
        p.avatar_url, 
        p.total_points, 
        p.season_points, 
        p.claims_count, 
        p.current_streak_days, 
        p.longest_streak_days, 
        p.last_streak_claim_at, 
        p.last_active_at, 
        p.created_at as "profileCreatedAt",
        a.role as admin_role
       FROM users u
       JOIN profiles p ON u.id = p.user_id
       LEFT JOIN admins a ON u.id = a.user_id AND a.revoked_at IS NULL
       WHERE LOWER(u.email) = LOWER($1);`,
      [email]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToPlayer(res.rows[0]);
  }

  public async findByUsername(username: string): Promise<Player | null> {
    const res = await this.pool.query(
      `SELECT 
        u.id, 
        u.email, 
        u.status, 
        u.created_at as "userCreatedAt",
        p.username, 
        p.display_name, 
        p.avatar_url, 
        p.total_points, 
        p.season_points, 
        p.claims_count, 
        p.current_streak_days, 
        p.longest_streak_days, 
        p.last_streak_claim_at, 
        p.last_active_at, 
        p.created_at as "profileCreatedAt",
        a.role as admin_role
       FROM users u
       JOIN profiles p ON u.id = p.user_id
       LEFT JOIN admins a ON u.id = a.user_id AND a.revoked_at IS NULL
       WHERE LOWER(p.username) = LOWER($1);`,
      [username]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToPlayer(res.rows[0]);
  }

  /**
   * Persists or updates player in users and profiles transactionally.
   */
  public async save(player: Player): Promise<void> {
    await transactionManager.runInTransaction(async (tx) => {
      // 1. Upsert into users - handle conflict on email to prevent duplicate accounts
      const userRes = await tx.query<{ id: string }>(
        `INSERT INTO users (id, email, status, email_verified_at, created_at, updated_at)
         VALUES ($1, LOWER($2), $3, NOW(), NOW(), NOW())
         ON CONFLICT (email) DO UPDATE 
         SET status = EXCLUDED.status,
             updated_at = NOW()
         RETURNING id;`,
        [player.id, player.props.email, player.props.status || 'active']
      );

      const canonicalUserId = userRes.rows[0]?.id || player.id;

      // 2. Upsert into profiles
      await tx.query(
        `INSERT INTO profiles (
           user_id, 
           username, 
           display_name, 
           avatar_url, 
           total_points, 
           season_points, 
           claims_count, 
           current_streak_days, 
           longest_streak_days, 
           last_active_at, 
           created_at, 
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE 
         SET display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
             avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
             total_points = EXCLUDED.total_points,
             season_points = EXCLUDED.season_points,
             claims_count = EXCLUDED.claims_count,
             current_streak_days = EXCLUDED.current_streak_days,
             longest_streak_days = GREATEST(profiles.longest_streak_days, EXCLUDED.longest_streak_days),
             last_active_at = EXCLUDED.last_active_at,
             updated_at = NOW();`,
        [
          canonicalUserId,
          player.username,
          player.props.displayName || null,
          player.props.avatarUrl || null,
          player.props.totalPoints || 0,
          player.props.seasonPoints || 0,
          player.props.claimsCount || 0,
          player.props.currentStreakDays || 0,
          player.props.currentStreakDays || 0,
          player.props.lastActiveAt || new Date(),
        ]
      );
    });
  }

  public async updatePoints(id: string, additionalPoints: number): Promise<void> {
    await this.pool.query(
      `UPDATE profiles
       SET total_points = total_points + $2,
           season_points = season_points + $2,
           claims_count = claims_count + 1,
           last_active_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $1;`,
      [id, additionalPoints]
    );
  }

  public async updatePointsTx(id: string, additionalPoints: number, tx: ITransactionContext): Promise<void> {
    await tx.query(
      `UPDATE profiles SET total_points = total_points + $1, season_points = season_points + $1 WHERE user_id = $2`,
      [additionalPoints, id]
    );
  }

  public async incrementStreak(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE profiles
       SET current_streak_days = current_streak_days + 1,
           longest_streak_days = GREATEST(longest_streak_days, current_streak_days + 1),
           last_streak_claim_at = NOW(),
           last_active_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $1;`,
      [id]
    );
  }

  private mapRowToPlayer(row: any): Player {
    // Exactly two application roles: STUDENT and ADMIN.
    // If an active (non-revoked) record exists in the admins table, the user is ADMIN; otherwise STUDENT.
    const role: PlayerRole = row.admin_role ? 'ADMIN' : 'STUDENT';

    const props: PlayerProps = {
      id: row.id,
      email: row.email,
      username: row.username,
      avatarUrl: row.avatar_url || undefined,
      displayName: row.display_name || undefined,
      status: row.status || 'active',
      totalPoints: Number(row.total_points) || 0,
      seasonPoints: Number(row.season_points) || 0,
      rank: 0,
      tier: 'tier1',
      claimsCount: Number(row.claims_count) || 0,
      currentStreakDays: Number(row.current_streak_days) || 0,
      role,
      createdAt: new Date(row.profileCreatedAt || row.userCreatedAt),
      lastActiveAt: new Date(row.last_active_at),
    };

    return new Player(props);
  }
}
