/**
 * Pure Domain Types & Enums
 * Strictly zero external dependencies.
 */

export type SpawnTier = 'tier1' | 'tier2' | 'tier3' | 'tier4';

export type SpawnStatus = 'active' | 'claimed' | 'cooldown' | 'expired';

export type PlayerRole = 'player' | 'admin' | 'superadmin';

export type RankChange = 'up' | 'down' | 'same';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface SvgCoordinates {
  x: number;
  y: number;
}

export interface BoundingBox {
  northWest: Coordinates;
  southEast: Coordinates;
}
