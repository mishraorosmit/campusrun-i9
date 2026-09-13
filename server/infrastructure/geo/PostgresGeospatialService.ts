import { Coordinates, SvgCoordinates } from '../../domain/types';
import { DatabasePool } from '../database/pool';
import {
  IGeospatialService,
  GeospatialSpawn,
  NearestSpawnOptions,
  SpawnsWithinRadiusOptions,
} from '../../services/IGeospatialService';
import { GeoService } from './GeoService';
import { PostgisGeoQueries } from './PostgisGeoQueries';

/**
 * Concrete PostgreSQL/PostGIS Geospatial Service Implementation
 * 
 * Satisfies the IGeospatialService contract by delegating authoritative boundary containment,
 * spatial KNN queries, and radius queries to PostGIS/PostgreSQL while keeping pure
 * mathematical transformations sub-millisecond in memory.
 */
export class PostgresGeospatialService implements IGeospatialService {
  constructor(private readonly pool: DatabasePool) {}

  public async isInsideCampus(point: Coordinates): Promise<boolean> {
    return PostgisGeoQueries.isInsideCampus(this.pool, point);
  }

  public distanceMeters(a: Coordinates, b: Coordinates): number {
    return GeoService.distanceBetweenPoints(a, b);
  }

  public async isMinimumDistanceSatisfied(
    point: Coordinates,
    existingPoints: Coordinates[],
    minMeters: number
  ): Promise<boolean> {
    const res = await PostgisGeoQueries.hasMinimumDistanceBetweenPoints(
      this.pool,
      point,
      existingPoints,
      minMeters
    );
    return res.isValid;
  }

  public async nearestSpawn(
    point: Coordinates,
    options?: NearestSpawnOptions
  ): Promise<GeospatialSpawn | null> {
    return PostgisGeoQueries.findNearestSpawn(this.pool, point, options);
  }

  public async spawnsWithinRadius(
    point: Coordinates,
    radiusMeters: number,
    options?: SpawnsWithinRadiusOptions
  ): Promise<GeospatialSpawn[]> {
    return PostgisGeoQueries.findSpawnsWithinRadius(this.pool, point, radiusMeters, options);
  }

  public gpsToSvg(point: Coordinates): SvgCoordinates {
    return GeoService.gpsToSvg(point);
  }

  public svgToGps(point: SvgCoordinates): Coordinates {
    return GeoService.svgToGps(point);
  }
}
