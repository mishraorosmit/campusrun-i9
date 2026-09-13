import { ISpawnRepository } from '../../../repositories/ISpawnRepository';
import { SpawnPoint, SpawnPointProps } from '../../../domain/entities/SpawnPoint';
import { BoundingBox, Coordinates } from '../../../domain/types';
import { ITransactionContext } from '../../../infrastructure/database/types';
import { dbPool } from '../../database/pool';


export class PostgresSpawnRepository implements ISpawnRepository {
  constructor(private readonly pool: any = dbPool.getPool()) {}

  public async findById(id: string): Promise<SpawnPoint | null> {
    const res = await this.pool.query(
      `SELECT 
        s.id,
        s.code,
        s.batch_id,
        s.title,
        s.description,
        s.clue,
        s.tier,
        s.points,
        s.claim_radius_meters,
        s.lat,
        s.lng,
        s.svg_x,
        s.svg_y,
        s.status,
        s.enabled,
        s.claim_count,
        s.max_claims,
        s.created_at,
        s.updated_at,
        b.expires_at as batch_expires_at
       FROM spawn_points s
       LEFT JOIN spawn_batches b ON s.batch_id = b.id
       WHERE s.id = $1`,
      [id]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToSpawnPoint(res.rows[0]);
  }

  public async findByCode(code: string): Promise<SpawnPoint | null> {
    const res = await this.pool.query(
      `SELECT 
        s.id,
        s.code,
        s.batch_id,
        s.title,
        s.description,
        s.clue,
        s.tier,
        s.points,
        s.claim_radius_meters,
        s.lat,
        s.lng,
        s.svg_x,
        s.svg_y,
        s.status,
        s.enabled,
        s.claim_count,
        s.max_claims,
        s.created_at,
        s.updated_at,
        b.expires_at as batch_expires_at
       FROM spawn_points s
       LEFT JOIN spawn_batches b ON s.batch_id = b.id
       WHERE s.code = $1`,
      [code]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToSpawnPoint(res.rows[0]);
  }

  public async findActive(): Promise<SpawnPoint[]> {
    const res = await this.pool.query(
      `SELECT 
        s.id,
        s.code,
        s.batch_id,
        s.title,
        s.description,
        s.clue,
        s.tier,
        s.points,
        s.claim_radius_meters,
        s.lat,
        s.lng,
        s.svg_x,
        s.svg_y,
        s.status,
        s.enabled,
        s.claim_count,
        s.max_claims,
        s.created_at,
        s.updated_at,
        b.expires_at as batch_expires_at
       FROM spawn_points s
       LEFT JOIN spawn_batches b ON s.batch_id = b.id
       WHERE s.enabled = true 
         AND s.status = 'active'
         AND (b.expires_at IS NULL OR b.expires_at > NOW())`
    );

    return res.rows.map((row: any) => this.mapRowToSpawnPoint(row));
  }

  public async findWithinBounds(bounds: BoundingBox): Promise<SpawnPoint[]> {
    const minLat = Math.min(bounds.northWest.lat, bounds.southEast.lat);
    const maxLat = Math.max(bounds.northWest.lat, bounds.southEast.lat);
    const minLng = Math.min(bounds.northWest.lng, bounds.southEast.lng);
    const maxLng = Math.max(bounds.northWest.lng, bounds.southEast.lng);

    const res = await this.pool.query(
      `SELECT 
        s.id,
        s.code,
        s.batch_id,
        s.title,
        s.description,
        s.clue,
        s.tier,
        s.points,
        s.claim_radius_meters,
        s.lat,
        s.lng,
        s.svg_x,
        s.svg_y,
        s.status,
        s.enabled,
        s.claim_count,
        s.max_claims,
        s.created_at,
        s.updated_at,
        b.expires_at as batch_expires_at
       FROM spawn_points s
       LEFT JOIN spawn_batches b ON s.batch_id = b.id
       WHERE s.lat >= $1 AND s.lat <= $2
         AND s.lng >= $3 AND s.lng <= $4
         AND s.enabled = true`,
      [minLat, maxLat, minLng, maxLng]
    );

    return res.rows.map((row: any) => this.mapRowToSpawnPoint(row));
  }

  public async findNearby(coords: Coordinates, radiusMeters: number): Promise<SpawnPoint[]> {
    const latDelta = radiusMeters / 111000;
    const lngDelta = radiusMeters / (111000 * Math.cos((coords.lat * Math.PI) / 180));

    const res = await this.pool.query(
      `SELECT 
        s.id,
        s.code,
        s.batch_id,
        s.title,
        s.description,
        s.clue,
        s.tier,
        s.points,
        s.claim_radius_meters,
        s.lat,
        s.lng,
        s.svg_x,
        s.svg_y,
        s.status,
        s.enabled,
        s.claim_count,
        s.max_claims,
        s.created_at,
        s.updated_at,
        b.expires_at as batch_expires_at
       FROM spawn_points s
       LEFT JOIN spawn_batches b ON s.batch_id = b.id
       WHERE s.lat >= $1 AND s.lat <= $2
         AND s.lng >= $3 AND s.lng <= $4
         AND s.enabled = true
         AND s.status = 'active'`,
      [coords.lat - latDelta, coords.lat + latDelta, coords.lng - lngDelta, coords.lng + lngDelta]
    );

    return res.rows.map((row: any) => this.mapRowToSpawnPoint(row));
  }

  public async save(spawn: SpawnPoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO spawn_points (
        id, code, title, description, clue, tier, points, claim_radius_meters,
        location, svg_x, svg_y, status, enabled, claim_count, max_claims, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        point($9, $10), $11, $12, $13, $14, $15, $16, $17, $18
      ) ON CONFLICT (id) DO UPDATE
      SET title = EXCLUDED.title,
          description = EXCLUDED.description,
          clue = EXCLUDED.clue,
          tier = EXCLUDED.tier,
          points = EXCLUDED.points,
          claim_radius_meters = EXCLUDED.claim_radius_meters,
          location = EXCLUDED.location,
          svg_x = EXCLUDED.svg_x,
          svg_y = EXCLUDED.svg_y,
          status = EXCLUDED.status,
          enabled = EXCLUDED.enabled,
          claim_count = EXCLUDED.claim_count,
          max_claims = EXCLUDED.max_claims,
          updated_at = NOW()`,
      [
        spawn.id,
        spawn.code,
        spawn.props.title,
        spawn.props.description || null,
        spawn.props.clue || null,
        spawn.props.tier,
        spawn.points,
        spawn.claimRadiusMeters,
        spawn.coordinates.lng,
        spawn.coordinates.lat,
        spawn.props.svgCoordinates.x,
        spawn.props.svgCoordinates.y,
        spawn.status,
        spawn.isEnabled,
        spawn.props.claimCount,
        spawn.props.maxClaims || null,
        spawn.props.spawnedAt || new Date(),
        new Date(),
      ]
    );
  }

  public async updateStatus(id: string, status: string, enabled?: boolean): Promise<void> {
    if (enabled !== undefined) {
      await this.pool.query(
        `UPDATE spawn_points 
         SET status = $1, enabled = $2, updated_at = NOW()
         WHERE id = $3`,
        [status, enabled, id]
      );
    } else {
      await this.pool.query(
        `UPDATE spawn_points 
         SET status = $1, updated_at = NOW()
         WHERE id = $2`,
        [status, id]
      );
    }
  }

  public async create(spawn: SpawnPoint, tx?: ITransactionContext): Promise<SpawnPoint> {
    const client = tx || this.pool;
    await client.query(
      `INSERT INTO spawn_points (
        id, code, batch_id, title, description, clue, tier, points, claim_radius_meters,
        lat, lng, svg_x, svg_y, status, enabled, claim_count, max_claims, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      )`,
      [
        spawn.id,
        spawn.code,
        (spawn as any).batchId || null,
        spawn.props.title,
        spawn.props.description || null,
        spawn.props.clue || null,
        spawn.props.tier,
        spawn.points,
        spawn.claimRadiusMeters,
        spawn.coordinates.lat,
        spawn.coordinates.lng,
        spawn.props.svgCoordinates.x,
        spawn.props.svgCoordinates.y,
        spawn.status,
        spawn.isEnabled,
        spawn.props.claimCount || 0,
        spawn.props.maxClaims || null,
        spawn.props.spawnedAt || new Date(),
        new Date(),
      ]
    );
    return spawn;
  }

  public async update(spawn: SpawnPoint, tx?: ITransactionContext): Promise<SpawnPoint> {
    const client = tx || this.pool;
    await client.query(
      `UPDATE spawn_points SET
        title = $2, description = $3, clue = $4, tier = $5, points = $6,
        claim_radius_meters = $7, lat = $8, lng = $9, svg_x = $10, svg_y = $11,
        status = $12, enabled = $13, updated_at = NOW()
       WHERE id = $1`,
      [
        spawn.id,
        spawn.props.title,
        spawn.props.description || null,
        spawn.props.clue || null,
        spawn.props.tier,
        spawn.points,
        spawn.claimRadiusMeters,
        spawn.coordinates.lat,
        spawn.coordinates.lng,
        spawn.props.svgCoordinates.x,
        spawn.props.svgCoordinates.y,
        spawn.status,
        spawn.isEnabled,
      ]
    );
    return spawn;
  }

  public async findAll(options?: import('../../../repositories/ISpawnRepository').SpawnFilterOptions): Promise<SpawnPoint[]> {
    let query = `
      SELECT s.*, b.expires_at as batch_expires_at
      FROM spawn_points s
      LEFT JOIN spawn_batches b ON s.batch_id = b.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIdx = 1;

    if (options?.status) {
      query += ` AND s.status = $${paramIdx++}`;
      params.push(options.status);
    }
    if (options?.enabled !== undefined) {
      query += ` AND s.enabled = $${paramIdx++}`;
      params.push(options.enabled);
    }
    if (options?.batchId) {
      query += ` AND s.batch_id = $${paramIdx++}`;
      params.push(options.batchId);
    }
    if (options?.tier) {
      query += ` AND s.tier = $${paramIdx++}`;
      params.push(options.tier);
    }
    query += ' ORDER BY s.created_at DESC';
    if (options?.limit) {
      query += ` LIMIT $${paramIdx++}`;
      params.push(options.limit);
    }
    if (options?.offset) {
      query += ` OFFSET $${paramIdx++}`;
      params.push(options.offset);
    }

    const res = await this.pool.query(query, params);
    return res.rows.map((row: any) => this.mapRowToSpawnPoint(row));
  }

  public async findAvailableForBatch(limit = 100): Promise<SpawnPoint[]> {
    const res = await this.pool.query(
      `SELECT s.*, NULL as batch_expires_at
       FROM spawn_points s
       WHERE s.enabled = true
         AND (s.batch_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM spawn_batches b
           WHERE b.id = s.batch_id AND b.status = 'active'
         ))
       ORDER BY RANDOM()
       LIMIT $1`,
      [limit]
    );
    return res.rows.map((row: any) => this.mapRowToSpawnPoint(row));
  }

  private mapRowToSpawnPoint(row: any): SpawnPoint {

    const props: SpawnPointProps = {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description || undefined,
      clue: row.clue || undefined,
      zoneId: row.zone_id || 'zone-default',
      zoneName: row.zone_name || 'Campus',
      coordinates: {
        lat: typeof row.lat === 'number' ? row.lat : parseFloat(row.lat),
        lng: typeof row.lng === 'number' ? row.lng : parseFloat(row.lng),
      },
      svgCoordinates: {
        x: typeof row.svg_x === 'number' ? row.svg_x : parseInt(row.svg_x || '0', 10),
        y: typeof row.svg_y === 'number' ? row.svg_y : parseInt(row.svg_y || '0', 10),
      },
      points: typeof row.points === 'number' ? row.points : parseInt(row.points, 10),
      tier: row.tier,
      status: row.status,
      claimRadiusMeters:
        typeof row.claim_radius_meters === 'number'
          ? row.claim_radius_meters
          : parseFloat(row.claim_radius_meters),
      enabled: row.enabled,
      spawnedAt: row.created_at ? new Date(row.created_at) : undefined,
      expiresAt: row.batch_expires_at
        ? new Date(row.batch_expires_at)
        : new Date(Date.now() + 24 * 60 * 60 * 1000),
      claimCount: typeof row.claim_count === 'number' ? row.claim_count : parseInt(row.claim_count || '0', 10),
      maxClaims: row.max_claims ? parseInt(row.max_claims, 10) : undefined,
    };

    return new SpawnPoint(props);
  }
}
