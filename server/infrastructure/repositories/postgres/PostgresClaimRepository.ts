import { IClaimRepository } from '../../../repositories/IClaimRepository';
import { Claim, ClaimProps } from '../../../domain/entities/Claim';
import { DatabasePool, dbPool } from '../../database/pool';
import { ITransactionContext } from '../../database/types';

export class PostgresClaimRepository implements IClaimRepository {
  constructor(private readonly pool: DatabasePool = dbPool) {}

  private getExecutor(tx?: ITransactionContext) {
    return tx || this.pool;
  }

  public async hasClaimed(spawnId: string, playerId: string, batchId?: string, tx?: ITransactionContext): Promise<boolean> {
    const executor = this.getExecutor(tx);
    const sql = batchId
      ? `SELECT 1 FROM claims WHERE spawn_id = $1 AND player_id = $2 AND batch_id = $3 LIMIT 1;`
      : `SELECT 1 FROM claims WHERE spawn_id = $1 AND player_id = $2 LIMIT 1;`;
    const params = batchId ? [spawnId, playerId, batchId] : [spawnId, playerId];
    const res = await executor.query(sql, params);
    return (res.rowCount ?? 0) > 0;
  }

  public async countBySpawnAndPlayer(spawnId: string, playerId: string, batchId?: string, tx?: ITransactionContext): Promise<number> {
    const executor = this.getExecutor(tx);
    const sql = batchId
      ? `SELECT COUNT(*)::int as count FROM claims WHERE spawn_id = $1 AND player_id = $2 AND batch_id = $3;`
      : `SELECT COUNT(*)::int as count FROM claims WHERE spawn_id = $1 AND player_id = $2;`;
    const params = batchId ? [spawnId, playerId, batchId] : [spawnId, playerId];
    const res = await executor.query<{ count: number }>(sql, params);
    return res.rows[0]?.count ?? 0;
  }

  public async findById(id: string, tx?: ITransactionContext): Promise<Claim | null> {
    const executor = this.getExecutor(tx);
    const sql = `
      SELECT 
        c.id,
        c.spawn_id as "spawnId",
        s.code as "spawnCode",
        s.title as "spawnTitle",
        c.player_id as "playerId",
        COALESCE(s.title, 'Campus Zone') as "zoneName",
        c.points_awarded as "pointsAwarded",
        c.claimed_at as "claimedAt",
        'common' as "tier",
        c.player_lat as "playerLat",
        c.player_lng as "playerLng",
        c.distance_meters as "distanceAtClaimMeters"
      FROM claims c
      LEFT JOIN spawn_points s ON s.id = c.spawn_id
      WHERE c.id = $1
      LIMIT 1;
    `;
    const res = await executor.query<any>(sql, [id]);
    if (!res.rows || res.rows.length === 0) return null;
    return this.mapRowToClaim(res.rows[0]);
  }

  public async findByPlayerId(playerId: string, limit: number = 50, tx?: ITransactionContext): Promise<Claim[]> {
    const executor = this.getExecutor(tx);
    const sql = `
      SELECT 
        c.id,
        c.spawn_id as "spawnId",
        s.code as "spawnCode",
        s.title as "spawnTitle",
        c.player_id as "playerId",
        COALESCE(s.title, 'Campus Zone') as "zoneName",
        c.points_awarded as "pointsAwarded",
        c.claimed_at as "claimedAt",
        'common' as "tier",
        c.player_lat as "playerLat",
        c.player_lng as "playerLng",
        c.distance_meters as "distanceAtClaimMeters"
      FROM claims c
      LEFT JOIN spawn_points s ON s.id = c.spawn_id
      WHERE c.player_id = $1
      ORDER BY c.claimed_at DESC
      LIMIT $2;
    `;
    const res = await executor.query<any>(sql, [playerId, limit]);
    return res.rows.map((r) => this.mapRowToClaim(r));
  }

  public async findRecent(limit: number = 20, tx?: ITransactionContext): Promise<Claim[]> {
    const executor = this.getExecutor(tx);
    const sql = `
      SELECT 
        c.id,
        c.spawn_id as "spawnId",
        s.code as "spawnCode",
        s.title as "spawnTitle",
        c.player_id as "playerId",
        COALESCE(s.title, 'Campus Zone') as "zoneName",
        c.points_awarded as "pointsAwarded",
        c.claimed_at as "claimedAt",
        'common' as "tier",
        c.player_lat as "playerLat",
        c.player_lng as "playerLng",
        c.distance_meters as "distanceAtClaimMeters"
      FROM claims c
      LEFT JOIN spawn_points s ON s.id = c.spawn_id
      ORDER BY c.claimed_at DESC
      LIMIT $1;
    `;
    const res = await executor.query<any>(sql, [limit]);
    return res.rows.map((r) => this.mapRowToClaim(r));
  }

  public async save(claim: Claim, tx?: ITransactionContext): Promise<void> {
    const executor = this.getExecutor(tx);
    const sql = `
      INSERT INTO claims (
        id, player_id, spawn_id, batch_id, points_awarded, streak_multiplier,
        distance_meters, player_location, claimed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, point($8, $9), $10
      )
      ON CONFLICT (player_id, spawn_id, batch_id) DO NOTHING;
    `;
    const batchId = (claim as any).props.batchId || (claim as any).batchId || '00000000-0000-0000-0000-000000000000';
    await executor.query(sql, [
      claim.id,
      claim.playerId,
      claim.spawnId,
      batchId,
      claim.pointsAwarded,
      1.00,
      claim.props.distanceAtClaimMeters || 0.0,
      claim.props.playerCoordinates.lng,
      claim.props.playerCoordinates.lat,
      claim.claimedAt,
    ]);
  }

  private mapRowToClaim(row: any): Claim {
    return new Claim({
      id: row.id,
      spawnId: row.spawnId,
      spawnCode: row.spawnCode || 'UNKNOWN',
      spawnTitle: row.spawnTitle || 'Campus Node',
      playerId: row.playerId,
      zoneName: row.zoneName || 'Campus Main',
      pointsAwarded: row.pointsAwarded,
      claimedAt: new Date(row.claimedAt),
      tier: row.tier || 'common',
      playerCoordinates: {
        lat: Number(row.playerLat),
        lng: Number(row.playerLng),
      },
      distanceAtClaimMeters: Number(row.distanceAtClaimMeters),
    });
  }
}
