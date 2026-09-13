import { Coordinates, SvgCoordinates } from '../domain/types';

export interface GeospatialSpawn {
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

export interface NearestSpawnOptions {
  batchId?: string;
  activeOnly?: boolean;
}

export interface SpawnsWithinRadiusOptions {
  batchId?: string;
  activeOnly?: boolean;
}

/**
 * Authoritative Geospatial Service Contract
 * 
 * Defines the public boundary for all geospatial calculations in Project I9.
 * All PostGIS and SQL details remain strictly hidden behind this contract.
 */
export interface IGeospatialService {
  /**
   * Validates whether a GPS point is strictly within the authoritative campus boundary.
   * PostGIS-backed server-side boundary check.
   */
  isInsideCampus(point: Coordinates): Promise<boolean>;

  /**
   * Calculates geodesic spherical distance between two GPS points in SI meters.
   */
  distanceMeters(a: Coordinates, b: Coordinates): number;

  /**
   * Validates that a new GPS coordinate maintains at least minMeters from all existing points.
   */
  isMinimumDistanceSatisfied(
    point: Coordinates,
    existingPoints: Coordinates[],
    minMeters: number
  ): Promise<boolean>;

  /**
   * Queries the geographically nearest spawn point using GiST spatial index acceleration.
   */
  nearestSpawn(
    point: Coordinates,
    options?: NearestSpawnOptions
  ): Promise<GeospatialSpawn | null>;

  /**
   * Queries all spawn points located within radius meters of a center GPS point.
   */
  spawnsWithinRadius(
    point: Coordinates,
    radiusMeters: number,
    options?: SpawnsWithinRadiusOptions
  ): Promise<GeospatialSpawn[]>;

  /**
   * Converts physical WGS 84 GPS coordinates to canonical SVG visual coordinates (1572 x 2927).
   */
  gpsToSvg(point: Coordinates): SvgCoordinates;

  /**
   * Converts canonical SVG visual coordinates (1572 x 2927) back to physical WGS 84 GPS coordinates.
   */
  svgToGps(point: SvgCoordinates): Coordinates;
}
