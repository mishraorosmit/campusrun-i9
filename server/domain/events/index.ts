import {
  IDomainEvent,
  SpawnClaimedPayload,
  RotationTriggeredPayload,
  PlayerStreakUpdatedPayload,
  LeaderboardResetPayload,
} from './IDomainEvent';

export class SpawnClaimedEvent implements IDomainEvent<SpawnClaimedPayload> {
  public readonly eventName = 'SPAWN_CLAIMED';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: SpawnClaimedPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

export class RotationTriggeredEvent implements IDomainEvent<RotationTriggeredPayload> {
  public readonly eventName = 'ROTATION_TRIGGERED';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: RotationTriggeredPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

export class PlayerStreakUpdatedEvent implements IDomainEvent<PlayerStreakUpdatedPayload> {
  public readonly eventName = 'PLAYER_STREAK_UPDATED';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: PlayerStreakUpdatedPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

export class LeaderboardResetEvent implements IDomainEvent<LeaderboardResetPayload> {
  public readonly eventName = 'LEADERBOARD_RESET';
  public readonly occurredAt = new Date();
  public readonly eventId: string;

  constructor(public readonly payload: LeaderboardResetPayload) {
    this.eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

export * from './IDomainEvent';
