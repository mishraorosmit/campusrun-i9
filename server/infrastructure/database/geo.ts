import { Coordinates, BoundingBox } from '../../domain/types';

/**
 * PostGIS Geospatial SQL Helpers & Coordinate Mapping
 *
 * CRITICAL COORDINATE ORDERING CONVENTION:
 * - Domain & HTTP API: { lat, lng } (Latitude first)
 * - PostGIS & WKT SQL: ST_MakePoint(lng, lat) (Longitude / X axis first)
 * - PostGIS Envelope: ST_MakeEnvelope(minLng, minLat, maxLng, maxLat, SRID)
 */
export class PostgisGeoSql {
  public static readonly SRID = 4326;

  /**
   * Generates a parameterized SQL expression creating a PostGIS GEOGRAPHY point.
   * Parameter order: $1 = lng, $2 = lat
   */
  public static makePointSql(lngPlaceholder: string, latPlaceholder: string): string {
    return `ST_SetSRID(ST_MakePoint(${lngPlaceholder}, ${latPlaceholder}), ${PostgisGeoSql.SRID})::geography`;
  }

  /**
   * Generates a parameterized SQL expression checking if a column is within radius meters of a point.
   */
  public static dWithinSql(
    columnName: string,
    lngPlaceholder: string,
    latPlaceholder: string,
    radiusMetersPlaceholder: string
  ): string {
    const pointSql = PostgisGeoSql.makePointSql(lngPlaceholder, latPlaceholder);
    return `ST_DWithin(${columnName}, ${pointSql}, ${radiusMetersPlaceholder})`;
  }

  /**
   * Generates a parameterized SQL expression calculating distance in meters between a column and a point.
   */
  public static distanceSql(
    columnName: string,
    lngPlaceholder: string,
    latPlaceholder: string
  ): string {
    const pointSql = PostgisGeoSql.makePointSql(lngPlaceholder, latPlaceholder);
    return `ST_Distance(${columnName}, ${pointSql})`;
  }

  /**
   * Generates a parameterized SQL expression checking if a polygon boundary covers a coordinate point.
   */
  public static coversPointSql(
    boundaryColumn: string,
    lngPlaceholder: string,
    latPlaceholder: string
  ): string {
    const pointSql = PostgisGeoSql.makePointSql(lngPlaceholder, latPlaceholder);
    return `ST_Covers(${boundaryColumn}, ${pointSql})`;
  }

  /**
   * Generates a parameterized SQL expression checking if a column is contained in a bounding box.
   */
  public static withinBoundsSql(
    columnName: string,
    minLngPlaceholder: string,
    minLatPlaceholder: string,
    maxLngPlaceholder: string,
    maxLatPlaceholder: string
  ): string {
    return `ST_Intersects(${columnName}, ST_MakeEnvelope(${minLngPlaceholder}, ${minLatPlaceholder}, ${maxLngPlaceholder}, ${maxLatPlaceholder}, ${PostgisGeoSql.SRID})::geography)`;
  }

  /**
   * Extracts typed Coordinates from a database query row containing lat/lng projections.
   */
  public static coordinatesFromRow(row: { lat?: unknown; lng?: unknown }): Coordinates {
    if (row.lat === undefined || row.lng === undefined || row.lat === null || row.lng === null) {
      throw new Error('[PostgisGeoSql] Row is missing lat or lng coordinates');
    }

    return {
      lat: typeof row.lat === 'number' ? row.lat : parseFloat(row.lat as string),
      lng: typeof row.lng === 'number' ? row.lng : parseFloat(row.lng as string),
    };
  }
}
