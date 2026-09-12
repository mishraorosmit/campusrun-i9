export interface IDomainEvent<T = unknown> {
  readonly eventId: string;
  readonly eventName: string;
  readonly occurredAt: Date;
  readonly payload: T;
}

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

export interface RotationTriggeredPayload {
  rotationId: string;
  rotationNumber: number;
  activatedSpawnCount: number;
  expiresAt: Date;
}

export interface PlayerStreakUpdatedPayload {
  playerId: string;
  previousStreak: number;
  currentStreak: number;
  totalPoints: number;
}

export interface LeaderboardResetPayload {
  resetTimestamp: Date;
  period: 'weekly' | 'season';
}
