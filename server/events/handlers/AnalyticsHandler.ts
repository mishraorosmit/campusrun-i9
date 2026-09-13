import { IEventBus } from '../IEventBus';
import { IAnalyticsRepository } from '../../repositories/IAnalyticsRepository';
import {
  IDomainEvent,
  DOMAIN_EVENT_NAMES,
  RotationTriggeredPayload,
  SpawnExpiredDomainPayload,
  SpawnClaimedPayload,
  RankChangedPayload,
  ResetApproachingPayload,
  LeaderboardResetPayload,
} from '../../domain/events';

/**
 * AnalyticsHandler
 * Subscribes to all domain events on the Domain Event Bus and records telemetry events
 * to the `analytics_events` table (or in-memory telemetry store).
 *
 * Fault Tolerance: All recording errors are caught and logged; failures never crash the event bus.
 */
export class AnalyticsHandler {
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly eventBus: IEventBus,
    private readonly analyticsRepo?: IAnalyticsRepository
  ) {
    this.register();
  }

  public register(): void {
    this.unregister();

    this.unsubscribers.push(
      this.eventBus.subscribe<RotationTriggeredPayload>(
        DOMAIN_EVENT_NAMES.SPAWN_ROTATED,
        this.handleSpawnRotated.bind(this)
      )
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<SpawnExpiredDomainPayload>(
        DOMAIN_EVENT_NAMES.SPAWN_EXPIRED,
        this.handleSpawnExpired.bind(this)
      )
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<SpawnClaimedPayload>(
        DOMAIN_EVENT_NAMES.CLAIM_SUCCESS,
        this.handleClaimSuccess.bind(this)
      )
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<RankChangedPayload>(
        DOMAIN_EVENT_NAMES.RANK_CHANGED,
        this.handleRankChanged.bind(this)
      )
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<ResetApproachingPayload>(
        DOMAIN_EVENT_NAMES.RESET_APPROACHING,
        this.handleResetApproaching.bind(this)
      )
    );

    this.unsubscribers.push(
      this.eventBus.subscribe<LeaderboardResetPayload>(
        DOMAIN_EVENT_NAMES.WEEKLY_RESET,
        this.handleWeeklyReset.bind(this)
      )
    );
  }

  public unregister(): void {
    for (const unsubscribe of this.unsubscribers) {
      try {
        unsubscribe();
      } catch (err) {
        console.error('[AnalyticsHandler] Error during unsubscribe:', err);
      }
    }
    this.unsubscribers = [];
  }

  /**
   * 1. SPAWN_ROTATED -> Telemetry event
   */
  public async handleSpawnRotated(event: IDomainEvent<RotationTriggeredPayload>): Promise<void> {
    try {
      const record = {
        eventName: 'SPAWN_ROTATED',
        userId: null,
        properties: {
          rotationId: event.payload.rotationId,
          rotationNumber: event.payload.rotationNumber,
          activatedSpawnCount: event.payload.activatedSpawnCount,
          expiresAt: event.payload.expiresAt ? event.payload.expiresAt.toISOString() : undefined,
        },
        createdAt: event.occurredAt,
      };

      if (this.analyticsRepo) {
        await this.analyticsRepo.record(record);
      }
    } catch (error) {
      console.error('[AnalyticsHandler] Error recording SPAWN_ROTATED analytics:', error);
    }
  }

  /**
   * 2. SPAWN_EXPIRED -> Telemetry event
   */
  public async handleSpawnExpired(event: IDomainEvent<SpawnExpiredDomainPayload>): Promise<void> {
    try {
      const record = {
        eventName: 'SPAWN_EXPIRED',
        userId: null,
        properties: {
          spawnIds: event.payload.spawnIds,
          spawnId: event.payload.spawnId,
          spawnCode: event.payload.spawnCode,
          zoneId: event.payload.zoneId,
          reason: event.payload.reason,
        },
        createdAt: event.occurredAt,
      };

      if (this.analyticsRepo) {
        await this.analyticsRepo.record(record);
      }
    } catch (error) {
      console.error('[AnalyticsHandler] Error recording SPAWN_EXPIRED analytics:', error);
    }
  }

  /**
   * 3. CLAIM_SUCCESS -> Telemetry event
   */
  public async handleClaimSuccess(event: IDomainEvent<SpawnClaimedPayload>): Promise<void> {
    try {
      const record = {
        eventName: 'CLAIM_SUCCESS',
        userId: event.payload.playerId,
        properties: {
          claimId: event.payload.claimId,
          spawnId: event.payload.spawnId,
          spawnCode: event.payload.spawnCode,
          points: event.payload.pointsAwarded,
          pointsAwarded: event.payload.pointsAwarded,
          playerLat: event.payload.playerLat,
          playerLng: event.payload.playerLng,
          zoneId: event.payload.zoneId,
        },
        createdAt: event.occurredAt,
      };

      if (this.analyticsRepo) {
        await this.analyticsRepo.record(record);
      }
    } catch (error) {
      console.error('[AnalyticsHandler] Error recording CLAIM_SUCCESS analytics:', error);
    }
  }

  /**
   * 4. RANK_CHANGED -> Telemetry event
   */
  public async handleRankChanged(event: IDomainEvent<RankChangedPayload>): Promise<void> {
    try {
      const record = {
        eventName: 'RANK_CHANGED',
        userId: event.payload.playerId,
        properties: {
          username: event.payload.username,
          oldRank: event.payload.oldRank,
          newRank: event.payload.newRank,
          points: event.payload.points,
          period: event.payload.period,
        },
        createdAt: event.occurredAt,
      };

      if (this.analyticsRepo) {
        await this.analyticsRepo.record(record);
      }
    } catch (error) {
      console.error('[AnalyticsHandler] Error recording RANK_CHANGED analytics:', error);
    }
  }

  /**
   * 5. RESET_APPROACHING -> Telemetry event
   */
  public async handleResetApproaching(event: IDomainEvent<ResetApproachingPayload>): Promise<void> {
    try {
      const record = {
        eventName: 'RESET_APPROACHING',
        userId: null,
        properties: {
          cycleId: event.payload.cycleId,
          minutesRemaining: event.payload.minutesRemaining,
          endsAt: event.payload.endsAt ? event.payload.endsAt.toISOString() : undefined,
        },
        createdAt: event.occurredAt,
      };

      if (this.analyticsRepo) {
        await this.analyticsRepo.record(record);
      }
    } catch (error) {
      console.error('[AnalyticsHandler] Error recording RESET_APPROACHING analytics:', error);
    }
  }

  /**
   * 6. WEEKLY_RESET -> Telemetry event
   */
  public async handleWeeklyReset(event: IDomainEvent<LeaderboardResetPayload>): Promise<void> {
    try {
      const record = {
        eventName: 'WEEKLY_RESET',
        userId: null,
        properties: {
          cycleId: event.payload.cycleId,
          resetKey: event.payload.resetKey,
          period: event.payload.period,
        },
        createdAt: event.occurredAt,
      };

      if (this.analyticsRepo) {
        await this.analyticsRepo.record(record);
      }
    } catch (error) {
      console.error('[AnalyticsHandler] Error recording WEEKLY_RESET analytics:', error);
    }
  }
}
