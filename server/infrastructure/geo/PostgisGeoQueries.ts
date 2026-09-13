import { Coordinates } from '../../domain/types';
import { DatabasePool } from '../database/pool';
import { GeoService } from './GeoService';
import { InvalidCoordinatesError } from './geoErrors';

export interface AuthoritativeSpawnResult {
  id: string;
  code: string;
  title: string;
  description: string | null;
  clue: string | null;
  tier: string;
  points: number;
  claimRadiusMeters: number;
  coordinates: Coordinates;
  svgX: number;
  svgY: number;
  status: string;
  enabled: boolean;
  distanceMeters: number;
}

export interface BoundaryValidationResult {
  isInside: boolean;
  distanceToBoundaryMeters: number;
  boundaryCode: string;
}

/**
 * Authoritative Server-Side Geospatial Query Engine
 * 
 * Enforces PostgreSQL/PostGIS as the single authoritative source of truth for:
 * - Campus boundary containment validation
 * - Geodetic distance calculations in meters (SRID 4326)
 * - Spatial index-accelerated nearest spawn queries (<-> operator)
 * - Spatial index-accelerated radius queries (ST_DWithin)
 * - Minimum distance between spawn points
 */
export class PostgisGeoQueries {
  private static postgisChecked: boolean = false;
  private static isPostgisAvailable: boolean = false;

  /**
   * Detects if PostGIS functions are available in the connected PostgreSQL instance.
   */
  public static async hasPostgis(pool: DatabasePool): Promise<boolean> {
    if (PostgisGeoQueries.postgisChecked) {
      return PostgisGeoQueries.isPostgisAvailable;
    }

    try {
      const res = await pool.query<{ has_geography: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'geography'
        ) AS has_geography;
      `);
      PostgisGeoQueries.isPostgisAvailable = Boolean(res.rows[0]?.has_geography);
      PostgisGeoQueries.postgisChecked = true;
    } catch {
      PostgisGeoQueries.isPostgisAvailable = false;
      PostgisGeoQueries.postgisChecked = true;
    }

    return PostgisGeoQueries.isPostgisAvailable;
  }

  /**
   * Authoritatively verifies if a GPS coordinate is inside the campus boundary in PostgreSQL.
   * Parameter order: $1 = lng, $2 = lat (PostGIS longitude-first convention)
   */
  public static async isInsideCampus(
    pool: DatabasePool,
    coords: Coordinates,
    boundaryCode: string = 'CANONICAL_CAMPUS'
  ): Promise<boolean> {
    const validated = GeoService.validateCoordinates(coords);
    const postgis = await PostgisGeoQueries.hasPostgis(pool);

    if (postgis) {
      const sql = `
        SELECT ST_Covers(
          boundary,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS is_inside
        FROM campus_boundaries
        WHERE code = $3 AND is_active = true
        LIMIT 1;
      `;
      const res = await pool.query<{ is_inside: boolean }>(sql, [validated.lng, validated.lat, boundaryCode]);
      return res.rows.length > 0 && Boolean(res.rows[0].is_inside);
    }

    // PostgreSQL native geometric polygon containment fallback with exact bounding checks
    const sql = `
      SELECT (
        boundary @> point($1, $2)
        AND $2 >= min_lat AND $2 <= max_lat
        AND $1 >= min_lng AND $1 <= max_lng
      ) AS is_inside
      FROM campus_boundaries
      WHERE code = $3 AND is_active = true
      LIMIT 1;
    `;
    const res = await pool.query<{ is_inside: boolean }>(sql, [validated.lng, validated.lat, boundaryCode]);
    if (res.rows.length > 0) {
      return Boolean(res.rows[0].is_inside);
    }

    // Fallback to authoritative memory bounding check
    return GeoService.isInsideCampus(validated);
  }

  /**
   * Authoritatively calculates distance in meters between two GPS coordinates in PostgreSQL.
   * Parameter order: ($1=lng1, $2=lat1), ($3=lng2, $4=lat2)
   */
  public static async calculateDistanceMeters(
    pool: DatabasePool,
    coord1: Coordinates,
    coord2: Coordinates
  ): Promise<number> {
    const c1 = GeoService.validateCoordinates(coord1);
    const c2 = GeoService.validateCoordinates(coord2);

    if (c1.lat === c2.lat && c1.lng === c2.lng) {
      return 0.0;
    }

    const postgis = await PostgisGeoQueries.hasPostgis(pool);

    if (postgis) {
      const sql = `
        SELECT ST_Distance(
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
        ) AS distance_meters;
      `;
      const res = await pool.query<{ distance_meters: number }>(sql, [
        c1.lng,
        c1.lat,
        c2.lng,
        c2.lat,
      ]);
      return Math.round(Number(res.rows[0].distance_meters) * 10) / 10;
    }

    // Server-side geodesic Haversine distance
    return GeoService.distanceBetweenPoints(c1, c2);
  }

  /**
   * Validates point position relative to the authoritative campus boundary and measures distance to boundary.
   */
  public static async validatePointToBoundary(
    pool: DatabasePool,
    coords: Coordinates,
    boundaryCode: string = 'CANONICAL_CAMPUS'
  ): Promise<BoundaryValidationResult> {
    const validated = GeoService.validateCoordinates(coords);
    const isInside = await PostgisGeoQueries.isInsideCampus(pool, validated, boundaryCode);
    const pointDist = GeoService.pointToBoundaryDistance(validated);

    return {
      isInside,
      distanceToBoundaryMeters: pointDist.distanceMeters,
      boundaryCode,
    };
  }

  /**
   * Authoritatively checks that a proposed coordinate maintains minimum spatial separation from existing points.
   */
  public static async hasMinimumDistanceBetweenPoints(
    pool: DatabasePool,
    newCoord: Coordinates,
    existingCoords: Coordinates[],
    minDistanceMeters: number
  ): Promise<{ isValid: boolean; violatedBy?: Coordinates; distanceMeters?: number }> {
    const validNew = GeoService.validateCoordinates(newCoord);

    if (minDistanceMeters < 0) {
      throw new Error(`minDistanceMeters cannot be negative (got ${minDistanceMeters})`);
    }

    for (const existing of existingCoords) {
      const validExisting = GeoService.validateCoordinates(existing);
      const distance = await PostgisGeoQueries.calculateDistanceMeters(pool, validNew, validExisting);
      if (distance < minDistanceMeters) {
        return {
          isValid: false,
          violatedBy: validExisting,
          distanceMeters: distance,
        };
      }
    }
    return { isValid: true };
  }

  /**
   * Queries the nearest spawn point to player GPS coordinates using GiST spatial index ordering.
   * Parameter order: $1 = lng, $2 = lat
   */
  public static async findNearestSpawn(
    pool: DatabasePool,
    playerCoords: Coordinates,
    options?: { batchId?: string; activeOnly?: boolean }
  ): Promise<AuthoritativeSpawnResult | null> {
    const validated = GeoService.validateCoordinates(playerCoords);
    const activeOnly = options?.activeOnly ?? true;
    const batchId = options?.batchId ?? null;

    // Ordered by GiST geometric distance operator `<->` for index acceleration
    const sql = `
      SELECT 
        id,
        code,
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters,
        lat,
        lng,
        svg_x,
        svg_y,
        status,
        enabled
      FROM spawn_points
      WHERE ($1::uuid IS NULL OR batch_id = $1)
        AND ($2::boolean IS FALSE OR (status = 'active' AND enabled = true))
      ORDER BY location <-> point($3, $4)
      LIMIT 1;
    `;

    const res = await pool.query<any>(sql, [batchId, activeOnly, validated.lng, validated.lat]);
    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    const spawnCoords: Coordinates = { lat: Number(row.lat), lng: Number(row.lng) };
    const distanceMeters = await PostgisGeoQueries.calculateDistanceMeters(pool, validated, spawnCoords);

    return {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      clue: row.clue,
      tier: row.tier,
      points: row.points,
      claimRadiusMeters: Number(row.claim_radius_meters),
      coordinates: spawnCoords,
      svgX: row.svg_x,
      svgY: row.svg_y,
      status: row.status,
      enabled: row.enabled,
      distanceMeters,
    };
  }

  /**
   * Queries all spawn points within radius meters of a center GPS coordinate.
   */
  public static async findSpawnsWithinRadius(
    pool: DatabasePool,
    centerCoords: Coordinates,
    radiusMeters: number,
    options?: { batchId?: string; activeOnly?: boolean }
  ): Promise<AuthoritativeSpawnResult[]> {
    const validated = GeoService.validateCoordinates(centerCoords);

    if (radiusMeters < 0) {
      throw new Error(`radiusMeters cannot be negative (got ${radiusMeters})`);
    }

    const activeOnly = options?.activeOnly ?? true;
    const batchId = options?.batchId ?? null;

    // 1 meter is approximately 0.000009 degrees latitude on Earth
    // We fetch candidate spawns in bounding box and calculate exact geodetic distance
    const degreeSlack = (radiusMeters / 111000) * 1.5;

    const sql = `
      SELECT 
        id,
        code,
        title,
        description,
        clue,
        tier,
        points,
        claim_radius_meters,
        lat,
        lng,
        svg_x,
        svg_y,
        status,
        enabled
      FROM spawn_points
      WHERE ($1::uuid IS NULL OR batch_id = $1)
        AND ($2::boolean IS FALSE OR (status = 'active' AND enabled = true))
        AND lat BETWEEN $3 AND $4
        AND lng BETWEEN $5 AND $6;
    `;

    const minLat = validated.lat - degreeSlack;
    const maxLat = validated.lat + degreeSlack;
    const minLng = validated.lng - degreeSlack;
    const maxLng = validated.lng + degreeSlack;

    const res = await pool.query<any>(sql, [
      batchId,
      activeOnly,
      minLat,
      maxLat,
      minLng,
      maxLng,
    ]);

    const results: AuthoritativeSpawnResult[] = [];

    for (const row of res.rows) {
      const spawnCoords: Coordinates = { lat: Number(row.lat), lng: Number(row.lng) };
      const distanceMeters = await PostgisGeoQueries.calculateDistanceMeters(pool, validated, spawnCoords);

      if (distanceMeters <= radiusMeters) {
        results.push({
          id: row.id,
          code: row.code,
          title: row.title,
          description: row.description,
          clue: row.clue,
          tier: row.tier,
          points: row.points,
          claimRadiusMeters: Number(row.claim_radius_meters),
          coordinates: spawnCoords,
          svgX: row.svg_x,
          svgY: row.svg_y,
          status: row.status,
          enabled: row.enabled,
          distanceMeters,
        });
      }
    }

    // Sort by distance ascending
    return results.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }
}
