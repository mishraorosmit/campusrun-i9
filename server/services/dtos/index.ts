import { Coordinates, SpawnTier, RankChange, PlayerRole } from '../../domain/types';

export interface SubmitClaimInputDTO {
  spawnId: string;
  playerId: string;
  playerCoordinates: Coordinates;
}

export interface ClaimResultDTO {
  success: boolean;
  claimId: string;
  spawnCode: string;
  pointsAwarded: number;
  tier: SpawnTier;
  distanceMeters: number;
  claimedAt: string;
}

export interface ClaimSummaryDTO {
  id: string;
  spawnId: string;
  spawnCode: string;
  spawnTitle: string;
  pointsAwarded: number;
  claimedAt: string;
  tier: SpawnTier;
  distanceMeters: number;
}

export interface SpawnSummaryDTO {
  id: string;
  code: string;
  title: string;
  tier: SpawnTier;
  status: string;
  points: number;
  claimRadiusMeters: number;
  coordinates: Coordinates;
  svgCoordinates: { x: number; y: number };
  zoneName: string;
  expiresAt: string;
}

export interface CampusZoneDTO {
  id: string;
  name: string;
  code: string;
  description: string;
  svgPath: string;
  centerCoordinates: Coordinates;
  centerSvgCoordinates: { x: number; y: number };
  activeSpawnsCount: number;
  totalPointsAvailable: number;
  color?: string;
}

export interface PlayerProfileDTO {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
  totalPoints: number;
  seasonPoints: number;
  rank: number;
  tier: string;
  claimsCount: number;
  currentStreakDays: number;
  role: PlayerRole;
}

export interface LeaderboardEntryDTO {
  rank: number;
  profile_id?: string;
  playerId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  points: number;
  claimsCount: number;
  tier: SpawnTier;
  rankChange: RankChange;
}

export interface AdminOverviewDTO {
  activeSpawnsCount: number;
  totalRecentClaims: number;
  serverTimestamp: string;
}
