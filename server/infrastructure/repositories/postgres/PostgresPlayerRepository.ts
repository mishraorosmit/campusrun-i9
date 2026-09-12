import { IPlayerRepository } from '../../../repositories/IPlayerRepository';
import { Player } from '../../../domain/entities/Player';
import { ITransactionContext } from '../../../repositories/ITransactionManager';

export class PostgresPlayerRepository implements IPlayerRepository {
  constructor(private readonly pool: import('pg').Pool) {}

  async updatePointsTx(id: string, additionalPoints: number, tx: ITransactionContext): Promise<void> {
    await tx.query(
      `UPDATE profiles SET total_points = total_points + $1, season_points = season_points + $1 WHERE user_id = $2`,
      [additionalPoints, id]
    );
  }

  async findById(id: string): Promise<Player | null> {
    const res = await this.pool.query('SELECT * FROM profiles WHERE user_id = $1', [id]);
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return new Player({
      id: row.user_id,
      email: row.email || '',
      username: row.username,
      totalPoints: row.total_points,
      seasonPoints: row.season_points,
      rank: 0,
      tier: 'tier1',
      claimsCount: row.claims_count,
      currentStreakDays: row.current_streak_days,
      campusZone: 'default',
      role: 'player',
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    });
  }

  // The rest are stubbed
  async findByEmail(email: string): Promise<Player | null> { throw new Error('Not implemented'); }
  async findByUsername(username: string): Promise<Player | null> { throw new Error('Not implemented'); }
  async save(player: Player): Promise<void> { throw new Error('Not implemented'); }
  async updatePoints(id: string, additionalPoints: number): Promise<void> { throw new Error('Not implemented'); }
  async incrementStreak(id: string): Promise<void> { throw new Error('Not implemented'); }
}
