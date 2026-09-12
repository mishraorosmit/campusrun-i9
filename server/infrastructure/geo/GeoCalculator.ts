import { Coordinates } from '../../domain/types';
import { IGeofencingService } from '../../domain/rules';

/**
 * Standard Haversine Distance Calculator
 * Calculates accurate geodesic distance in meters between two coordinates.
 */
export class GeoCalculator implements IGeofencingService {
  private static readonly EARTH_RADIUS_METERS = 6371000;

  public calculateDistanceMeters(coord1: Coordinates, coord2: Coordinates): number {
    const lat1Rad = this.toRadians(coord1.lat);
    const lat2Rad = this.toRadians(coord2.lat);
    const deltaLatRad = this.toRadians(coord2.lat - coord1.lat);
    const deltaLngRad = this.toRadians(coord2.lng - coord1.lng);

    const a =
      Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(GeoCalculator.EARTH_RADIUS_METERS * c * 10) / 10;
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}

export const geoCalculator = new GeoCalculator();
