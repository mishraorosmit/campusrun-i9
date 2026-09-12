import { IClaimRepository } from '../../../repositories/IClaimRepository';
import { Claim } from '../../../domain/entities/Claim';
import { ITransactionContext } from '../../../repositories/ITransactionManager';

export class PostgresClaimRepository implements IClaimRepository {
  constructor(private readonly pool: import('pg').Pool) {}

  async saveTx(claim: Claim, tx: ITransactionContext): Promise<boolean> {
    const res = await tx.query(`
      INSERT INTO claims (
        id, player_id, spawn_id, batch_id, points_awarded, streak_multiplier, distance_meters, player_location, claimed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, ST_MakePoint($8, $9), $10
      ) ON CONFLICT (player_id, spawn_id) DO NOTHING
    `, [
      claim.id,
      claim.playerId,
      claim.spawnId,
      '00000000-0000-0000-0000-000000000000', // fallback if empty since it's required in schema
      claim.pointsAwarded,
      1.0, // default multiplier
      claim.props.distanceAtClaimMeters,
      claim.props.playerCoordinates.lng,
      claim.props.playerCoordinates.lat,
      claim.claimedAt
    ]);

    // return true if a row was inserted
    return res.rowCount !== null && res.rowCount > 0;
  }

  async countBySpawnAndPlayer(spawnId: string, playerId: string): Promise<number> {
    const res = await this.pool.query(
      'SELECT COUNT(*) as count FROM claims WHERE spawn_id = $1 AND player_id = $2',
      [spawnId, playerId]
    );
    return parseInt(res.rows[0].count, 10);
  }

  // The rest are stubbed
  async findById(id: string): Promise<Claim | null> { throw new Error('Not implemented'); }
  async findByPlayerId(playerId: string, limit?: number): Promise<Claim[]> { throw new Error('Not implemented'); }
  async save(claim: Claim): Promise<void> { throw new Error('Not implemented'); }
  async findRecent(limit?: number): Promise<Claim[]> { throw new Error('Not implemented'); }
}
