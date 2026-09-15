import { IEventBus } from '../IEventBus';
import { IRealtimeService } from '../../services/IRealtimeService';
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
 * RealtimeEventHandler
 * Subscribes to the internal Domain Event Bus and fans out minimal delta payloads
 * over Socket.IO via IRealtimeService.
 *
 * Rules:
 * 1. Minimal delta payloads only; strictly NO full-state dumps.
 * 2. Public broadcasts are sent to campus_global (strictly NO PII).
 * 3. Personal receipts and rank updates are routed to user-specific private rooms.
 * 4. Fault isolation: Errors are caught and logged; failures never crash the event bus.
 */
export class RealtimeEventHandler {
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly eventBus: IEventBus,
    private readonly realtimeService: IRealtimeService
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
        console.error('[RealtimeEventHandler] Error during unsubscribe:', err);
      }
    }
    this.unsubscribers = [];
  }

  /**
   * 1. SPAWN_ROTATED -> Broadcast batch creation signal to campus_global
   */
  public handleSpawnRotated(event: IDomainEvent<RotationTriggeredPayload>): void {
    try {
      this.realtimeService.broadcastSpawnBatchCreated({
        rotationNumber: event.payload.rotationNumber,
        spawns: [],
        expiresAt: event.payload.expiresAt ? event.payload.expiresAt.toISOString() : undefined,
        timestamp: event.occurredAt.toISOString(),
      });
    } catch (error) {
      console.error('[RealtimeEventHandler] Error handling SPAWN_ROTATED:', error);
    }
  }

  /**
   * 2. SPAWN_EXPIRED -> Broadcast spawn expiration delta to campus_global
   */
  public handleSpawnExpired(event: IDomainEvent<SpawnExpiredDomainPayload>): void {
    try {
      this.realtimeService.broadcastSpawnsExpired({
        spawnIds: event.payload.spawnIds || (event.payload.spawnId ? [event.payload.spawnId] : []),
        spawnId: event.payload.spawnId,
        spawnCode: event.payload.spawnCode,
        reason: event.payload.reason,
        timestamp: event.occurredAt.toISOString(),
      });
    } catch (error) {
      console.error('[RealtimeEventHandler] Error handling SPAWN_EXPIRED:', error);
    }
  }

  /**
   * 3. CLAIM_SUCCESS -> Anonymous broadcast to campus_global + personal receipt to user:<userId>
   */
  public handleClaimSuccess(event: IDomainEvent<SpawnClaimedPayload>): void {
    try {
      const { spawnId, spawnCode, pointsAwarded, playerId, claimId, zoneId } = event.payload;

      // 1. Anonymous global broadcast (NO PII)
      this.realtimeService.broadcastPublicClaim({
        spawnId,
        spawnCode,
        pointsAwarded,
        zoneName: zoneId,
        timestamp: event.occurredAt.toISOString(),
      });

      // 2. Personal claim receipt to user:<userId> room
      if (playerId) {
        this.realtimeService.emitPersonalClaimSuccess(playerId, {
          claimId,
          spawnId,
          spawnCode,
          playerId,
          pointsAwarded,
          claimedAt: event.occurredAt.toISOString(),
        });
      }
    } catch (error) {
      console.error('[RealtimeEventHandler] Error handling CLAIM_SUCCESS:', error);
    }
  }

  /**
   * 4. RANK_CHANGED -> Broadcast minimal leaderboard rank delta update to campus_global
   */
  public handleRankChanged(event: IDomainEvent<RankChangedPayload>): void {
    try {
      const { playerId, newRank, oldRank, points, period } = event.payload;

      this.realtimeService.broadcastLeaderboardUpdated({
        type: period || 'weekly',
        playerRankDelta: {
          playerId,
          oldRank: oldRank !== null ? oldRank : undefined,
          newRank,
          points,
        },
        updatedAt: event.occurredAt.toISOString(),
      });
    } catch (error) {
      console.error('[RealtimeEventHandler] Error handling RANK_CHANGED:', error);
    }
  }

  /**
   * 5. RESET_APPROACHING -> Broadcast lightweight signal that cycle reset is near
   */
  public handleResetApproaching(event: IDomainEvent<ResetApproachingPayload>): void {
    try {
      if (this.realtimeService.broadcastLeaderboardTick) {
        this.realtimeService.broadcastLeaderboardTick({
          updatedAt: event.occurredAt.toISOString(),
        });
      } else {
        this.realtimeService.broadcastLeaderboardUpdated({
          type: 'weekly',
          updatedAt: event.occurredAt.toISOString(),
        });
      }
    } catch (error) {
      console.error('[RealtimeEventHandler] Error handling RESET_APPROACHING:', error);
    }
  }

  /**
   * 6. WEEKLY_RESET -> Broadcast leaderboard weekly reset to campus_global
   */
  public handleWeeklyReset(event: IDomainEvent<LeaderboardResetPayload>): void {
    try {
      this.realtimeService.broadcastLeaderboardWeeklyReset({
        cycleId: event.payload.cycleId || '',
        resetKey: event.payload.resetKey || '',
        executedAt: event.occurredAt.toISOString(),
        nextResetAt: '',
      });
    } catch (error) {
      console.error('[RealtimeEventHandler] Error handling WEEKLY_RESET:', error);
    }
  }
}
