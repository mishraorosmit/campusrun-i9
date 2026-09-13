import { IZoneRepository } from '../../../repositories/IZoneRepository';
import { CampusZone } from '../../../domain/entities/CampusZone';
import { DatabasePool, dbPool } from '../../database/pool';

export class PostgresZoneRepository implements IZoneRepository {
  constructor(private readonly pool: DatabasePool = dbPool) {}

  public async findAll(): Promise<CampusZone[]> {
    const res = await this.pool.query<any>(
      `SELECT 
        id, 
        name, 
        code, 
        description, 
        svg_path as "svgPath", 
        center_lat as "centerLat", 
        center_lng as "centerLng", 
        center_svg_x as "centerSvgX", 
        center_svg_y as "centerSvgY", 
        active_spawns_count as "activeSpawnsCount", 
        total_points_available as "totalPointsAvailable", 
        color 
       FROM campus_zones 
       ORDER BY code ASC;`
    );

    return res.rows.map((row) => this.mapRowToZone(row));
  }

  public async findById(id: string): Promise<CampusZone | null> {
    const res = await this.pool.query<any>(
      `SELECT 
        id, 
        name, 
        code, 
        description, 
        svg_path as "svgPath", 
        center_lat as "centerLat", 
        center_lng as "centerLng", 
        center_svg_x as "centerSvgX", 
        center_svg_y as "centerSvgY", 
        active_spawns_count as "activeSpawnsCount", 
        total_points_available as "totalPointsAvailable", 
        color 
       FROM campus_zones 
       WHERE id = $1 OR code = $1;`,
      [id]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToZone(res.rows[0]);
  }

  public async save(zone: CampusZone): Promise<void> {
    await this.pool.query(
      `INSERT INTO campus_zones (
        id, name, code, description, svg_path,
        center_lat, center_lng, center_svg_x, center_svg_y,
        active_spawns_count, total_points_available, color, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        code = EXCLUDED.code,
        description = EXCLUDED.description,
        svg_path = EXCLUDED.svg_path,
        center_lat = EXCLUDED.center_lat,
        center_lng = EXCLUDED.center_lng,
        center_svg_x = EXCLUDED.center_svg_x,
        center_svg_y = EXCLUDED.center_svg_y,
        active_spawns_count = EXCLUDED.active_spawns_count,
        total_points_available = EXCLUDED.total_points_available,
        color = EXCLUDED.color,
        updated_at = NOW();`,
      [
        zone.id,
        zone.props.name,
        zone.props.code,
        zone.props.description,
        zone.props.svgPath,
        zone.props.centerCoordinates.lat,
        zone.props.centerCoordinates.lng,
        zone.props.centerSvgCoordinates.x,
        zone.props.centerSvgCoordinates.y,
        zone.props.activeSpawnsCount,
        zone.props.totalPointsAvailable,
        zone.props.color || null,
      ]
    );
  }

  private mapRowToZone(row: any): CampusZone {
    return new CampusZone({
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      svgPath: row.svgPath,
      centerCoordinates: {
        lat: Number(row.centerLat),
        lng: Number(row.centerLng),
      },
      centerSvgCoordinates: {
        x: Number(row.centerSvgX),
        y: Number(row.centerSvgY),
      },
      activeSpawnsCount: Number(row.activeSpawnsCount),
      totalPointsAvailable: Number(row.totalPointsAvailable),
      color: row.color || undefined,
    });
  }
}
