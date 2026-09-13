import {
  IDomainEvent,
  RotationTriggeredPayload,
  SpawnExpiredDomainPayload,
  SpawnClaimedPayload,
  RankChangedPayload,
  ResetApproachingPayload,
  LeaderboardResetPayload,
  PlayerStreakUpdatedPayload,
} from './IDomainEvent';

/**
 * 1. SPAWN_ROTATED (Mapped to RotationTriggeredEvent)
 */
export class RotationTriggeredEvent implements IDomainEvent<RotationTriggeredPayload> {
  public readonly eventName = 'ROTATION_TRIGGERED';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: RotationTriggeredPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
export { RotationTriggeredEvent as SpawnRotatedEvent };

/**
 * 2. SPAWN_EXPIRED
 */
export class SpawnExpiredEvent implements IDomainEvent<SpawnExpiredDomainPayload> {
  public readonly eventName = 'SPAWN_EXPIRED';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: SpawnExpiredDomainPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * 3. CLAIM_SUCCESS (Mapped to SpawnClaimedEvent)
 */
export class SpawnClaimedEvent implements IDomainEvent<SpawnClaimedPayload> {
  public readonly eventName = 'SPAWN_CLAIMED';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: SpawnClaimedPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
export { SpawnClaimedEvent as ClaimSuccessEvent };

/**
 * 4. RANK_CHANGED
 */
export class RankChangedEvent implements IDomainEvent<RankChangedPayload> {
  public readonly eventName = 'RANK_CHANGED';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: RankChangedPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * 5. RESET_APPROACHING
 */
export class ResetApproachingEvent implements IDomainEvent<ResetApproachingPayload> {
  public readonly eventName = 'RESET_APPROACHING';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: ResetApproachingPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * 6. WEEKLY_RESET (Mapped to LeaderboardResetEvent)
 */
export class LeaderboardResetEvent implements IDomainEvent<LeaderboardResetPayload> {
  public readonly eventName = 'LEADERBOARD_RESET';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: LeaderboardResetPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
export { LeaderboardResetEvent as WeeklyResetDomainEvent };

/**
 * Additional existing domain events
 */
export class PlayerStreakUpdatedEvent implements IDomainEvent<PlayerStreakUpdatedPayload> {
  public readonly eventName = 'PLAYER_STREAK_UPDATED';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: PlayerStreakUpdatedPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Logical Domain Event Name Constants
 */
export const DOMAIN_EVENT_NAMES = {
  SPAWN_ROTATED: 'ROTATION_TRIGGERED',
  SPAWN_EXPIRED: 'SPAWN_EXPIRED',
  CLAIM_SUCCESS: 'SPAWN_CLAIMED',
  RANK_CHANGED: 'RANK_CHANGED',
  RESET_APPROACHING: 'RESET_APPROACHING',
  WEEKLY_RESET: 'LEADERBOARD_RESET',
  PLAYER_STREAK_UPDATED: 'PLAYER_STREAK_UPDATED',
} as const;

export * from './IDomainEvent';
