import { Coordinates, SvgCoordinates } from '../../domain/types';
import { AUTHORITATIVE_CAMPUS_BOUNDS } from './campusBounds';
import { InvalidCoordinatesError, InvalidSvgCoordinatesError } from './geoErrors';

/**
 * Pure Geospatial Service
 * 
 * Provides decoupled, deterministic coordinate transformations, boundary verification,
 * and geodetic distance calculations without HTTP, Express, or database dependencies.
 */
export class GeoService {
  private static readonly EARTH_RADIUS_METERS = 6371000;

  /**
   * Validates that an unknown input is a valid GPS Coordinate object with finite values in range.
   */
  public static validateCoordinates(coords: unknown): Coordinates {
    if (!coords || typeof coords !== 'object') {
      throw new InvalidCoordinatesError('Coordinates must be an object with numeric lat and lng properties.');
    }
    const { lat, lng } = coords as Record<string, unknown>;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || isNaN(lat)) {
      throw new InvalidCoordinatesError('Latitude must be a valid finite number.', { lat });
    }
    if (typeof lng !== 'number' || !Number.isFinite(lng) || isNaN(lng)) {
      throw new InvalidCoordinatesError('Longitude must be a valid finite number.', { lng });
    }
    if (lat < -90 || lat > 90) {
      throw new InvalidCoordinatesError('Latitude must be between -90 and 90 degrees.', { lat });
    }
    if (lng < -180 || lng > 180) {
      throw new InvalidCoordinatesError('Longitude must be between -180 and 180 degrees.', { lng });
    }
    return { lat, lng };
  }

  /**
   * Validates that an unknown input is a valid SVG Coordinate object with finite numeric values.
   */
  public static validateSvgCoordinates(svgCoords: unknown): SvgCoordinates {
    if (!svgCoords || typeof svgCoords !== 'object') {
      throw new InvalidSvgCoordinatesError('SVG coordinates must be an object with numeric x and y properties.');
    }
    const { x, y } = svgCoords as Record<string, unknown>;
    if (typeof x !== 'number' || !Number.isFinite(x) || isNaN(x)) {
      throw new InvalidSvgCoordinatesError('SVG x coordinate must be a valid finite number.', { x });
    }
    if (typeof y !== 'number' || !Number.isFinite(y) || isNaN(y)) {
      throw new InvalidSvgCoordinatesError('SVG y coordinate must be a valid finite number.', { y });
    }
    return { x, y };
  }

  /**
   * Maps physical GPS Coordinates (WGS 84, lat/lng) to canonical SVG visual coordinates (1572 x 2927).
   */
  public static gpsToSvg(coords: Coordinates): SvgCoordinates;
  public static gpsToSvg(lat: number, lng: number): SvgCoordinates;
  public static gpsToSvg(coordsOrLat: Coordinates | number, maybeLng?: number): SvgCoordinates {
    const rawCoords = typeof coordsOrLat === 'number' ? { lat: coordsOrLat, lng: maybeLng! } : coordsOrLat;
    const validated = GeoService.validateCoordinates(rawCoords);

    const { northWest, southEast, svgWidth, svgHeight, latSpan, lngSpan } = AUTHORITATIVE_CAMPUS_BOUNDS;

    // Normalize between 0 and 1
    const normX = Math.max(0, Math.min(1, (validated.lng - northWest.lng) / lngSpan));
    const normY = Math.max(0, Math.min(1, (northWest.lat - validated.lat) / latSpan));

    return {
      x: Math.round(normX * svgWidth),
      y: Math.round(normY * svgHeight),
    };
  }

  /**
   * Maps canonical SVG visual coordinates (1572 x 2927) back to physical GPS Coordinates (WGS 84, lat/lng).
   */
  public static svgToGps(svgCoords: SvgCoordinates): Coordinates;
  public static svgToGps(x: number, y: number): Coordinates;
  public static svgToGps(coordsOrX: SvgCoordinates | number, maybeY?: number): Coordinates {
    const rawSvg = typeof coordsOrX === 'number' ? { x: coordsOrX, y: maybeY! } : coordsOrX;
    const validated = GeoService.validateSvgCoordinates(rawSvg);

    const { northWest, svgWidth, svgHeight, latSpan, lngSpan } = AUTHORITATIVE_CAMPUS_BOUNDS;

    const normX = Math.max(0, Math.min(1, validated.x / svgWidth));
    const normY = Math.max(0, Math.min(1, validated.y / svgHeight));

    const lat = Number((northWest.lat - normY * latSpan).toFixed(6));
    const lng = Number((northWest.lng + normX * lngSpan).toFixed(6));

    return { lat, lng };
  }

  /**
   * Checks if a GPS coordinate falls within the authoritative institutional campus boundary.
   */
  public static isInsideCampus(coords: Coordinates): boolean {
    const validated = GeoService.validateCoordinates(coords);
    const { northWest, southEast } = AUTHORITATIVE_CAMPUS_BOUNDS;
    return (
      validated.lat >= southEast.lat &&
      validated.lat <= northWest.lat &&
      validated.lng >= northWest.lng &&
      validated.lng <= southEast.lng
    );
  }

  /**
   * Computes accurate geodesic spherical distance in meters between two GPS coordinates
   * using the Haversine formula on a standard WGS 84 mean earth radius (6,371,000m).
   */
  public static distanceBetweenPoints(coord1: Coordinates, coord2: Coordinates): number {
    const c1 = GeoService.validateCoordinates(coord1);
    const c2 = GeoService.validateCoordinates(coord2);

    // Identical coordinates short-circuit
    if (c1.lat === c2.lat && c1.lng === c2.lng) {
      return 0.0;
    }

    const toRad = (degrees: number) => (degrees * Math.PI) / 180;

    const lat1Rad = toRad(c1.lat);
    const lat2Rad = toRad(c2.lat);
    const deltaLatRad = toRad(c2.lat - c1.lat);
    const deltaLngRad = toRad(c2.lng - c1.lng);

    const a =
      Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(GeoService.EARTH_RADIUS_METERS * c * 10) / 10;
  }

  /**
   * Validates that a new point maintains at least minDistanceMeters from all existing points.
   */
  public static validateMinimumDistance(
    newCoord: Coordinates,
    existingCoords: Coordinates[],
    minDistanceMeters: number
  ): { isValid: boolean; violatedBy?: Coordinates; distanceMeters?: number } {
    const validNew = GeoService.validateCoordinates(newCoord);

    if (minDistanceMeters < 0) {
      throw new Error(`minDistanceMeters cannot be negative (got ${minDistanceMeters})`);
    }

    for (const existing of existingCoords) {
      const validExisting = GeoService.validateCoordinates(existing);
      const distance = GeoService.distanceBetweenPoints(validNew, validExisting);
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
   * Calculates the shortest distance in meters from a coordinate to the perimeter boundary of the campus.
   */
  public static pointToBoundaryDistance(coords: Coordinates): {
    isInside: boolean;
    distanceMeters: number;
  } {
    const validated = GeoService.validateCoordinates(coords);
    const { northWest, southEast } = AUTHORITATIVE_CAMPUS_BOUNDS;
    const isInside = GeoService.isInsideCampus(validated);

    if (isInside) {
      // Distance to the closest boundary segment (North, South, East, West)
      const distToNorth = GeoService.distanceBetweenPoints(validated, { lat: northWest.lat, lng: validated.lng });
      const distToSouth = GeoService.distanceBetweenPoints(validated, { lat: southEast.lat, lng: validated.lng });
      const distToWest = GeoService.distanceBetweenPoints(validated, { lat: validated.lat, lng: northWest.lng });
      const distToEast = GeoService.distanceBetweenPoints(validated, { lat: validated.lat, lng: southEast.lng });

      const minDistance = Math.min(distToNorth, distToSouth, distToWest, distToEast);
      return { isInside: true, distanceMeters: minDistance };
    }

    // Clamped closest point on rectangular boundary
    const closestLat = Math.max(southEast.lat, Math.min(northWest.lat, validated.lat));
    const closestLng = Math.max(northWest.lng, Math.min(southEast.lng, validated.lng));

    const distanceToPerimeter = GeoService.distanceBetweenPoints(validated, {
      lat: closestLat,
      lng: closestLng,
    });

    return { isInside: false, distanceMeters: distanceToPerimeter };
  }
}

// Export top-level bound functions for direct functional usage
export const gpsToSvg = GeoService.gpsToSvg;
export const svgToGps = GeoService.svgToGps;
export const isInsideCampus = GeoService.isInsideCampus;
export const distanceBetweenPoints = GeoService.distanceBetweenPoints;
export const validateMinimumDistance = GeoService.validateMinimumDistance;
export const pointToBoundaryDistance = GeoService.pointToBoundaryDistance;
export const validateCoordinates = GeoService.validateCoordinates;
export const validateSvgCoordinates = GeoService.validateSvgCoordinates;
