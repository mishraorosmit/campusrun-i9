import { Coordinates, SpawnTier, RankChange, PlayerRole } from '../../domain/types';

export interface SubmitClaimInputDTO {
  spawnId: string;
  playerId: string;
  playerCoordinates: Coordinates;
}

export interface ClaimResultDTO {
  success: boolean;
  claimId: string;
  spawnId: string;
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
  description?: string;
  clue?: string;
  tier: SpawnTier;
  status: string;
  points: number;
  claimRadiusMeters: number;
  coordinates: Coordinates;
  svgCoordinates: { x: number; y: number };
  lat?: number;
  lng?: number;
  svgX?: number;
  svgY?: number;
  zoneId?: string;
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
  centerLat?: number;
  centerLng?: number;
  centerSvgX?: number;
  centerSvgY?: number;
  activeSpawnsCount: number;
  totalPointsAvailable: number;
  color?: string;
}

export interface PlayerProfileDTO {
  id: string;
  username: string;
  displayName?: string;
  email: string;
  avatarUrl?: string;
  totalPoints: number;
  seasonPoints: number;
  rank: number;
  tier: string;
  claimsCount: number;
  currentStreakDays: number;
  preferences?: Record<string, string | number | boolean | null>;
  role: PlayerRole;
}

export interface PlayerStatsDTO {
  playerId: string;
  totalPoints: number;
  seasonPoints: number;
  claimsCount: number;
  currentStreakDays: number;
  rank?: number | null;
  weeklyRank?: number | null;
  allTimeRank?: number | null;
  tier?: string;
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

export interface NotificationDTO {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  readAt?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: string;
}

export interface PushSubscriptionKeysDTO {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInputDTO {
  endpoint: string;
  keys?: PushSubscriptionKeysDTO;
  p256dh?: string;
  auth?: string;
  userAgent?: string;
}

export interface PushSubscriptionResultDTO {
  id: string;
  endpoint: string;
  createdAt: string;
}

export interface GameCycleDTO {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
}

export interface GameStateDTO {
  status: string;
  serverTimestamp: string;
  activeSpawnsCount: number;
  currentCycle?: GameCycleDTO | null;
  nextResetAt?: string | null;
}

export interface GameRotationDTO {
  id: string;
  rotationNumber: number;
  startedAt: string;
  expiresAt: string;
  totalSpawns: number;
  activeSpawns: number;
  nextRotationInSeconds: number;
  isExpired: boolean;
}
