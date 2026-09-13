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

  async countBySpawnAndPlayer(spawnId: string, playerId: string, _batchId?: string): Promise<number> {
    const res = await this.pool.query(
      'SELECT COUNT(*) as count FROM claims WHERE spawn_id = $1 AND player_id = $2',
      [spawnId, playerId]
    );
    return parseInt(res.rows[0].count, 10);
  }

  async findById(id: string): Promise<Claim | null> {
    const res = await this.pool.query(
      `SELECT 
        c.id,
        c.player_id,
        c.spawn_id,
        c.batch_id,
        c.points_awarded,
        c.streak_multiplier,
        c.distance_meters,
        c.player_lat,
        c.player_lng,
        c.claimed_at,
        COALESCE(s.code, 'SPAWN') as spawn_code,
        COALESCE(s.title, 'Spawn Location') as spawn_title,
        COALESCE(s.tier, 'tier1') as spawn_tier
       FROM claims c
       LEFT JOIN spawn_points s ON c.spawn_id = s.id
       WHERE c.id = $1`,
      [id]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    const row = res.rows[0];
    return new Claim({
      id: row.id,
      spawnId: row.spawn_id,
      spawnCode: row.spawn_code,
      spawnTitle: row.spawn_title,
      playerId: row.player_id,
      zoneName: 'Campus',
      pointsAwarded: row.points_awarded,
      claimedAt: new Date(row.claimed_at),
      distanceAtClaimMeters: row.distance_meters,
      tier: row.spawn_tier,
      playerCoordinates: {
        lat: row.player_lat || 0,
        lng: row.player_lng || 0,
      },
    });
  }

  async findByPlayerId(playerId: string, limit = 50): Promise<Claim[]> {
    const res = await this.pool.query(
      `SELECT 
        c.id,
        c.player_id,
        c.spawn_id,
        c.batch_id,
        c.points_awarded,
        c.streak_multiplier,
        c.distance_meters,
        c.player_lat,
        c.player_lng,
        c.claimed_at,
        COALESCE(s.code, 'SPAWN') as spawn_code,
        COALESCE(s.title, 'Spawn Location') as spawn_title,
        COALESCE(s.tier, 'tier1') as spawn_tier
       FROM claims c
       LEFT JOIN spawn_points s ON c.spawn_id = s.id
       WHERE c.player_id = $1
       ORDER BY c.claimed_at DESC
       LIMIT $2`,
      [playerId, limit]
    );

    return res.rows.map(
      (row) =>
        new Claim({
          id: row.id,
          spawnId: row.spawn_id,
          spawnCode: row.spawn_code,
          spawnTitle: row.spawn_title,
          playerId: row.player_id,
          zoneName: 'Campus',
          pointsAwarded: row.points_awarded,
          claimedAt: new Date(row.claimed_at),
          distanceAtClaimMeters: row.distance_meters,
          tier: row.spawn_tier,
          playerCoordinates: {
            lat: row.player_lat || 0,
            lng: row.player_lng || 0,
          },
        })
    );
  }

  async hasClaimed(spawnId: string, playerId: string, batchId?: string): Promise<boolean> {
    const count = await this.countBySpawnAndPlayer(spawnId, playerId, batchId);
    return count > 0;
  }

  async save(claim: Claim): Promise<void> {
    await this.pool.query(
      `INSERT INTO claims (
        id, player_id, spawn_id, batch_id, points_awarded, streak_multiplier, distance_meters, player_location, claimed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, ST_MakePoint($8, $9), $10
      ) ON CONFLICT (player_id, spawn_id) DO NOTHING`,
      [
        claim.id,
        claim.playerId,
        claim.spawnId,
        '00000000-0000-0000-0000-000000000000',
        claim.pointsAwarded,
        1.0,
        claim.props.distanceAtClaimMeters,
        claim.props.playerCoordinates.lng,
        claim.props.playerCoordinates.lat,
        claim.claimedAt,
      ]
    );
  }

  async findRecent(limit = 20): Promise<Claim[]> {
    const res = await this.pool.query(
      `SELECT 
        c.id,
        c.player_id,
        c.spawn_id,
        c.batch_id,
        c.points_awarded,
        c.streak_multiplier,
        c.distance_meters,
        c.player_lat,
        c.player_lng,
        c.claimed_at,
        COALESCE(s.code, 'SPAWN') as spawn_code,
        COALESCE(s.title, 'Spawn Location') as spawn_title,
        COALESCE(s.tier, 'tier1') as spawn_tier
       FROM claims c
       LEFT JOIN spawn_points s ON c.spawn_id = s.id
       ORDER BY c.claimed_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.rows.map(
      (row) =>
        new Claim({
          id: row.id,
          spawnId: row.spawn_id,
          spawnCode: row.spawn_code,
          spawnTitle: row.spawn_title,
          playerId: row.player_id,
          zoneName: 'Campus',
          pointsAwarded: row.points_awarded,
          claimedAt: new Date(row.claimed_at),
          distanceAtClaimMeters: row.distance_meters,
          tier: row.spawn_tier,
          playerCoordinates: {
            lat: row.player_lat || 0,
            lng: row.player_lng || 0,
          },
        })
    );
  }
}
