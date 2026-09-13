export interface IDomainEvent<T = unknown> {
  readonly eventId: string;
  readonly eventName: string;
  readonly occurredAt: Date;
  readonly payload: T;
}

// ============================================================================
// 1. SPAWN_ROTATED (Mapped from RotationTriggeredPayload)
// ============================================================================
export interface RotationTriggeredPayload {
  rotationId: string;
  rotationNumber: number;
  activatedSpawnCount: number;
  expiresAt: Date;
}
export type SpawnRotatedPayload = RotationTriggeredPayload;

// ============================================================================
// 2. SPAWN_EXPIRED
// ============================================================================
export interface SpawnExpiredDomainPayload {
  spawnIds: string[];
  spawnId?: string;
  spawnCode?: string;
  zoneId?: string;
  reason?: 'WINDOW_EXPIRED' | 'ROTATED' | 'DISABLED' | string;
  expiredAt: Date;
}

// ============================================================================
// 3. CLAIM_SUCCESS (Mapped from SpawnClaimedPayload)
// ============================================================================
export interface SpawnClaimedPayload {
  claimId: string;
  spawnId: string;
  spawnCode: string;
  playerId: string;
  pointsAwarded: number;
  playerLat: number;
  playerLng: number;
  zoneId: string;
}
export type ClaimSuccessPayload = SpawnClaimedPayload;

// ============================================================================
// 4. RANK_CHANGED
// ============================================================================
export interface RankChangedPayload {
  playerId: string;
  username?: string;
  oldRank?: number | null;
  newRank: number;
  points: number;
  period: 'weekly' | 'all-time';
  timestamp: Date;
}

// ============================================================================
// 5. RESET_APPROACHING
// ============================================================================
export interface ResetApproachingPayload {
  cycleId: string;
  endsAt: Date;
  minutesRemaining: number;
  timestamp: Date;
}

// ============================================================================
// 6. WEEKLY_RESET (Mapped from LeaderboardResetPayload)
// ============================================================================
export interface LeaderboardResetPayload {
  cycleId?: string;
  resetKey?: string;
  resetTimestamp: Date;
  period: 'weekly' | 'season';
}
export type WeeklyResetDomainPayload = LeaderboardResetPayload;

// ============================================================================
// Additional existing domain payloads
// ============================================================================
export interface PlayerStreakUpdatedPayload {
  playerId: string;
  previousStreak: number;
  currentStreak: number;
  totalPoints: number;
}
