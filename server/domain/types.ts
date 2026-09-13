/**
 * Pure Domain Types & Enums
 * Strictly zero external dependencies.
 */

export type SpawnTier = 'tier1' | 'tier2' | 'tier3' | 'tier4';

export type SpawnStatus = 'active' | 'claimed' | 'cooldown' | 'expired';

export type PlayerRole = 'STUDENT' | 'ADMIN' | 'player' | 'admin' | 'superadmin';

export type WeeklyCycleStatus = 'active' | 'completed' | 'upcoming' | 'archived';

export type ResetType = 'scheduled' | 'manual';

export type NotificationType =
  | 'spawn_rotation'
  | 'claim_reward'
  | 'streak_reminder'
  | 'leaderboard_rank'
  | 'system_announcement';

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
