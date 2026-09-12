import { SpawnPoint } from '../entities/SpawnPoint';
import { Coordinates } from '../types';

export interface IGeofencingService {
  calculateDistanceMeters(coord1: Coordinates, coord2: Coordinates): number;
}

export class GeofencingRules {
  public static isWithinClaimRadius(
    playerCoords: Coordinates,
    spawn: SpawnPoint,
    geoCalculator: IGeofencingService
  ): { isWithin: boolean; distanceMeters: number } {
    const distanceMeters = geoCalculator.calculateDistanceMeters(playerCoords, spawn.coordinates);
    return {
      isWithin: distanceMeters <= spawn.claimRadiusMeters,
      distanceMeters,
    };
  }
}

export class ClaimRules {
  public static validateCanClaim(
    spawn: SpawnPoint,
    playerClaimsCountForSpawn: number
  ): { canClaim: boolean; reason?: string } {
    if (!spawn.isEnabled) {
      return { canClaim: false, reason: 'Spawn is currently disabled by administrators' };
    }

    if (spawn.status !== 'active') {
      return { canClaim: false, reason: `Spawn is not active (current status: ${spawn.status})` };
    }

    if (spawn.isExpired) {
      return { canClaim: false, reason: 'Spawn rotation window has expired' };
    }

    if (playerClaimsCountForSpawn > 0) {
      return { canClaim: false, reason: 'Player has already claimed this spawn point during the current rotation' };
    }

    return { canClaim: true };
  }
}

export class ScoringRules {
  public static getPointsForTier(tier: string): number {
    switch (tier) {
      case 'tier4':
        return 500;
      case 'tier3':
        return 250;
      case 'tier2':
        return 150;
      case 'tier1':
      default:
        return 75;
    }
  }
}
