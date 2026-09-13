import { ISpawnRepository, SpawnFilterOptions, ActiveSpawnFilterOptions } from '../../../repositories/ISpawnRepository';
import { SpawnPoint, SpawnPointProps } from '../../../domain/entities/SpawnPoint';
import { BoundingBox, Coordinates, SpawnTier, SpawnStatus } from '../../../domain/types';
import { DatabasePool, dbPool } from '../../database/pool';
import { ITransactionContext } from '../../database/types';
import { GeoService } from '../../geo/GeoService';
import { NotFoundError } from '../../../errors/NotFoundError';

export class PostgresSpawnRepository implements ISpawnRepository {
  constructor(private readonly pool: DatabasePool = dbPool) {}

  private getExecutor(tx?: ITransactionContext): {
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
  } {
    return tx || this.pool;
  }

  public async create(spawn: SpawnPoint, tx?: ITransactionContext): Promise<SpawnPoint> {
    const executor = this.getExecutor(tx);
    const sql = `
      INSERT INTO spawn_points (
        id,
        code,
        batch_id,
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters,
        location,
        svg_x,
        svg_y,
        status,
        enabled,
        claim_count,
        max_claims,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, point($10, $11), $12, $13, $14, $15,
        $16, $17, NOW(), NOW()
      )
      RETURNING
        id,
        code,
        batch_id as "batchId",
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters as "claimRadiusMeters",
        lat,
        lng,
        svg_x as "svgX",
        svg_y as "svgY",
        status,
        enabled,
        claim_count as "claimCount",
        max_claims as "maxClaims",
        created_at as "createdAt",
        updated_at as "updatedAt";
    `;

    const res = await executor.query<any>(sql, [
      spawn.id,
      spawn.code,
      spawn.props.batchId || null,
      spawn.title,
      spawn.description || null,
      spawn.clue || null,
      spawn.tier,
      spawn.points,
      spawn.claimRadiusMeters,
      spawn.coordinates.lng, // location[0] is lng
      spawn.coordinates.lat, // location[1] is lat
      spawn.svgCoordinates.x,
      spawn.svgCoordinates.y,
      spawn.status,
      spawn.isEnabled,
      spawn.claimCount,
      spawn.maxClaims || null,
    ]);

    return this.mapRowToSpawn(res.rows[0]);
  }

  public async update(spawn: SpawnPoint, tx?: ITransactionContext): Promise<SpawnPoint> {
    const executor = this.getExecutor(tx);
    const sql = `
      UPDATE spawn_points
      SET
        code = $2,
        batch_id = $3,
        title = $4,
        description = $5,
        clue = $6,
        tier = $7,
        points = $8,
        claim_radius_meters = $9,
        location = point($10, $11),
        svg_x = $12,
        svg_y = $13,
        status = $14,
        enabled = $15,
        claim_count = $16,
        max_claims = $17,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        code,
        batch_id as "batchId",
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters as "claimRadiusMeters",
        lat,
        lng,
        svg_x as "svgX",
        svg_y as "svgY",
        status,
        enabled,
        claim_count as "claimCount",
        max_claims as "maxClaims",
        created_at as "createdAt",
        updated_at as "updatedAt";
    `;

    const res = await executor.query<any>(sql, [
      spawn.id,
      spawn.code,
      spawn.props.batchId || null,
      spawn.title,
      spawn.description || null,
      spawn.clue || null,
      spawn.tier,
      spawn.points,
      spawn.claimRadiusMeters,
      spawn.coordinates.lng,
      spawn.coordinates.lat,
      spawn.svgCoordinates.x,
      spawn.svgCoordinates.y,
      spawn.status,
      spawn.isEnabled,
      spawn.claimCount,
      spawn.maxClaims || null,
    ]);

    if (!res.rows || res.rows.length === 0) {
      throw new NotFoundError(`Spawn point "${spawn.id}" not found for update.`);
    }

    return this.mapRowToSpawn(res.rows[0]);
  }

  public async findById(id: string, tx?: ITransactionContext): Promise<SpawnPoint | null> {
    const executor = this.getExecutor(tx);
    const sql = `
      SELECT
        id,
        code,
        batch_id as "batchId",
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters as "claimRadiusMeters",
        lat,
        lng,
        svg_x as "svgX",
        svg_y as "svgY",
        status,
        enabled,
        claim_count as "claimCount",
        max_claims as "maxClaims",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM spawn_points
      WHERE id = $1;
    `;

    const res = await executor.query<any>(sql, [id]);
    if (!res.rows || res.rows.length === 0) {
      return null;
    }

    return this.mapRowToSpawn(res.rows[0]);
  }

  public async findByCode(code: string, tx?: ITransactionContext): Promise<SpawnPoint | null> {
    const executor = this.getExecutor(tx);
    const sql = `
      SELECT
        id,
        code,
        batch_id as "batchId",
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters as "claimRadiusMeters",
        lat,
        lng,
        svg_x as "svgX",
        svg_y as "svgY",
        status,
        enabled,
        claim_count as "claimCount",
        max_claims as "maxClaims",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM spawn_points
      WHERE LOWER(code) = LOWER($1);
    `;

    const res = await executor.query<any>(sql, [code.trim()]);
    if (!res.rows || res.rows.length === 0) {
      return null;
    }

    return this.mapRowToSpawn(res.rows[0]);
  }

  public async findAll(options: SpawnFilterOptions = {}): Promise<SpawnPoint[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (options.status) {
      conditions.push(`status = $${idx++}`);
      params.push(options.status);
    }

    if (options.enabled !== undefined) {
      conditions.push(`enabled = $${idx++}`);
      params.push(options.enabled);
    }

    if (options.batchId) {
      conditions.push(`batch_id = $${idx++}`);
      params.push(options.batchId);
    }

    if (options.tier) {
      conditions.push(`tier = $${idx++}`);
      params.push(options.tier);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(options.limit || 100, 500);
    const offset = Math.max(options.offset || 0, 0);

    const sql = `
      SELECT
        id,
        code,
        batch_id as "batchId",
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters as "claimRadiusMeters",
        lat,
        lng,
        svg_x as "svgX",
        svg_y as "svgY",
        status,
        enabled,
        claim_count as "claimCount",
        max_claims as "maxClaims",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM spawn_points
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const res = await this.pool.query<any>(sql, params);
    return res.rows.map((r) => this.mapRowToSpawn(r));
  }

  public async findActive(options: ActiveSpawnFilterOptions = {}): Promise<SpawnPoint[]> {
    const conditions: string[] = ['status = \'active\'', 'enabled = true'];
    const params: unknown[] = [];
    let idx = 1;

    if (options.batchId) {
      conditions.push(`batch_id = $${idx++}`);
      params.push(options.batchId);
    }

    if (options.bounds) {
      const minLat = Math.min(options.bounds.northWest.lat, options.bounds.southEast.lat);
      const maxLat = Math.max(options.bounds.northWest.lat, options.bounds.southEast.lat);
      const minLng = Math.min(options.bounds.northWest.lng, options.bounds.southEast.lng);
      const maxLng = Math.max(options.bounds.northWest.lng, options.bounds.southEast.lng);

      conditions.push(`lat BETWEEN $${idx++} AND $${idx++}`);
      params.push(minLat, maxLat);
      conditions.push(`lng BETWEEN $${idx++} AND $${idx++}`);
      params.push(minLng, maxLng);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = Math.min(options.limit || 100, 500);
    const offset = Math.max(options.offset || 0, 0);

    const sql = `
      SELECT
        id,
        code,
        batch_id as "batchId",
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters as "claimRadiusMeters",
        lat,
        lng,
        svg_x as "svgX",
        svg_y as "svgY",
        status,
        enabled,
        claim_count as "claimCount",
        max_claims as "maxClaims",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM spawn_points
      ${whereClause}
      ORDER BY points DESC, created_at DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const res = await this.pool.query<any>(sql, params);
    return res.rows.map((r) => this.mapRowToSpawn(r));
  }

  public async findAvailableForBatch(limit: number = 10): Promise<SpawnPoint[]> {
    // Strictly requires enabled = true so disabled spawns cannot be selected for batches
    const sql = `
      SELECT
        id,
        code,
        batch_id as "batchId",
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters as "claimRadiusMeters",
        lat,
        lng,
        svg_x as "svgX",
        svg_y as "svgY",
        status,
        enabled,
        claim_count as "claimCount",
        max_claims as "maxClaims",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM spawn_points
      WHERE enabled = true
      ORDER BY claim_count ASC, created_at DESC
      LIMIT $1;
    `;

    const res = await this.pool.query<any>(sql, [limit]);
    return res.rows.map((r) => this.mapRowToSpawn(r));
  }

  public async findWithinBounds(bounds: BoundingBox): Promise<SpawnPoint[]> {
    const minLat = Math.min(bounds.northWest.lat, bounds.southEast.lat);
    const maxLat = Math.max(bounds.northWest.lat, bounds.southEast.lat);
    const minLng = Math.min(bounds.northWest.lng, bounds.southEast.lng);
    const maxLng = Math.max(bounds.northWest.lng, bounds.southEast.lng);

    const sql = `
      SELECT
        id,
        code,
        batch_id as "batchId",
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters as "claimRadiusMeters",
        lat,
        lng,
        svg_x as "svgX",
        svg_y as "svgY",
        status,
        enabled,
        claim_count as "claimCount",
        max_claims as "maxClaims",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM spawn_points
      WHERE lat BETWEEN $1 AND $2
        AND lng BETWEEN $3 AND $4
      ORDER BY created_at DESC;
    `;

    const res = await this.pool.query<any>(sql, [minLat, maxLat, minLng, maxLng]);
    return res.rows.map((r) => this.mapRowToSpawn(r));
  }

  public async findNearby(coords: Coordinates, radiusMeters: number): Promise<SpawnPoint[]> {
    const validated = GeoService.validateCoordinates(coords);
    const degreeSlack = (radiusMeters / 111000) * 1.5;

    const minLat = validated.lat - degreeSlack;
    const maxLat = validated.lat + degreeSlack;
    const minLng = validated.lng - degreeSlack;
    const maxLng = validated.lng + degreeSlack;

    const sql = `
      SELECT
        id,
        code,
        batch_id as "batchId",
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters as "claimRadiusMeters",
        lat,
        lng,
        svg_x as "svgX",
        svg_y as "svgY",
        status,
        enabled,
        claim_count as "claimCount",
        max_claims as "maxClaims",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM spawn_points
      WHERE lat BETWEEN $1 AND $2
        AND lng BETWEEN $3 AND $4;
    `;

    const res = await this.pool.query<any>(sql, [minLat, maxLat, minLng, maxLng]);
    const results: SpawnPoint[] = [];

    for (const row of res.rows) {
      const spawn = this.mapRowToSpawn(row);
      const dist = GeoService.distanceBetweenPoints(validated, spawn.coordinates);
      if (dist <= radiusMeters) {
        results.push(spawn);
      }
    }

    return results;
  }

  public async save(spawn: SpawnPoint, tx?: ITransactionContext): Promise<void> {
    const existing = await this.findById(spawn.id, tx);
    if (existing) {
      await this.update(spawn, tx);
    } else {
      await this.create(spawn, tx);
    }
  }

  public async updateStatus(
    id: string,
    status: string,
    enabled?: boolean,
    tx?: ITransactionContext
  ): Promise<void> {
    const executor = this.getExecutor(tx);
    const updates: string[] = ['status = $2', 'updated_at = NOW()'];
    const params: unknown[] = [id, status];

    if (enabled !== undefined) {
      updates.push(`enabled = $3`);
      params.push(enabled);
    }

    const sql = `
      UPDATE spawn_points
      SET ${updates.join(', ')}
      WHERE id = $1;
    `;

    const res = await executor.query(sql, params);
    if (res.rowCount === 0) {
      throw new NotFoundError(`Spawn point "${id}" not found.`);
    }
  }

  private mapRowToSpawn(row: any): SpawnPoint {
    const props: SpawnPointProps = {
      id: row.id,
      code: row.code,
      batchId: row.batchId || null,
      title: row.title,
      description: row.description || null,
      clue: row.clue || null,
      tier: row.tier as SpawnTier,
      points: Number(row.points),
      claimRadiusMeters: Number(row.claimRadiusMeters),
      coordinates: {
        lat: Number(row.lat),
        lng: Number(row.lng),
      },
      svgCoordinates: {
        x: Number(row.svgX),
        y: Number(row.svgY),
      },
      status: row.status as SpawnStatus,
      enabled: Boolean(row.enabled),
      claimCount: Number(row.claimCount || 0),
      maxClaims: row.maxClaims ? Number(row.maxClaims) : null,
      zoneId: 'zone-canonical',
      zoneName: 'Campus Core',
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };

    return new SpawnPoint(props);
  }
}
