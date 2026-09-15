import { IEventBus } from '../IEventBus';
import { IPushSubscriptionRepository } from '../../repositories/IPushSubscriptionRepository';
import { IPlayerRepository } from '../../repositories/IPlayerRepository';
import { IWebPushSender, WebPushSender, PushNotificationPayload } from '../../infrastructure/push/WebPushSender';
import { PushDeliveryService } from '../../services/PushDeliveryService';
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
 * WebPushHandler
 * Subscribes to the Domain Event Bus and dispatches targeted Web Push notifications
 * to user subscriptions via PushDeliveryService.
 *
 * Four Core Notification Types:
 * 1. Spawn notification (RotationTriggeredEvent / SpawnExpiredEvent)
 * 2. Claim notification (SpawnClaimedEvent)
 * 3. Rank-change notification (RankChangedEvent)
 * 4. Reset notification (ResetApproachingEvent / LeaderboardResetEvent)
 *
 * Rules:
 * - Personal events (CLAIM_SUCCESS, RANK_CHANGED) target only that player's subscriptions.
 * - Broadcast events (SPAWN_ROTATED, RESET_APPROACHING, WEEKLY_RESET) target all subscribed devices.
 * - User notification preferences are respected.
 * - Fault isolation: All push dispatch errors are caught and logged; failures never crash the event bus.
 */
export class WebPushHandler {
  private unsubscribers: Array<() => void> = [];
  private readonly pushDeliveryService?: PushDeliveryService;
  private readonly pushSender?: IWebPushSender;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly pushSubRepo: IPushSubscriptionRepository,
    senderOrDeliveryService?: IWebPushSender | PushDeliveryService,
    private readonly playerRepo?: IPlayerRepository
  ) {
    if (senderOrDeliveryService instanceof PushDeliveryService) {
      this.pushDeliveryService = senderOrDeliveryService;
    } else if (
      senderOrDeliveryService &&
      typeof (senderOrDeliveryService as any).sendPush === 'function'
    ) {
      this.pushSender = senderOrDeliveryService as IWebPushSender;
    } else {
      this.pushDeliveryService = new PushDeliveryService(this.pushSubRepo, this.playerRepo);
    }

    this.register();
  }

  public register(): void {
    this.unregister();

    // 1. Spawn notifications (Rotation / Expiration)
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

    // 2. Claim notifications
    this.unsubscribers.push(
      this.eventBus.subscribe<SpawnClaimedPayload>(
        DOMAIN_EVENT_NAMES.CLAIM_SUCCESS,
        this.handleClaimSuccess.bind(this)
      )
    );

    // 3. Rank-change notifications
    this.unsubscribers.push(
      this.eventBus.subscribe<RankChangedPayload>(
        DOMAIN_EVENT_NAMES.RANK_CHANGED,
        this.handleRankChanged.bind(this)
      )
    );

    // 4. Reset notifications (Approaching / Reset)
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
        console.error('[WebPushHandler] Error during unsubscribe:', err);
      }
    }
    this.unsubscribers = [];
  }

  /**
   * Helper: Dispatches payload to a specific user using PushDeliveryService or fallback pushSender
   */
  private async dispatchToUser(userId: string, payload: PushNotificationPayload): Promise<void> {
    if (this.pushDeliveryService) {
      await this.pushDeliveryService.sendToUser(userId, payload);
    } else if (this.pushSender) {
      const subscriptions = await this.pushSubRepo.findByUserId(userId);
      if (!subscriptions || subscriptions.length === 0) return;

      await Promise.all(
        subscriptions.map((sub) =>
          this.pushSender!.sendPush(sub, payload).catch((err) => {
            console.error(`[WebPushHandler] Error dispatching push to ${sub.endpoint}:`, err);
          })
        )
      );
    }
  }

  /**
   * Helper: Broadcasts payload to all subscribed users
   */
  private async broadcastPayload(payload: PushNotificationPayload): Promise<void> {
    if (this.pushDeliveryService) {
      const subscriptions = await this.pushSubRepo.findAll();
      if (!subscriptions || subscriptions.length === 0) return;

      const userIds = Array.from(new Set(subscriptions.map((s) => s.userId)));
      await Promise.allSettled(
        userIds.map((userId) => this.pushDeliveryService!.sendToUser(userId, payload))
      );
    } else if (this.pushSender) {
      const subscriptions = await this.pushSubRepo.findAll();
      if (!subscriptions || subscriptions.length === 0) return;

      await Promise.all(
        subscriptions.map((sub) =>
          this.pushSender!.sendPush(sub, payload).catch((err) => {
            console.error(`[WebPushHandler] Error dispatching broadcast push to ${sub.endpoint}:`, err);
          })
        )
      );
    }
  }

  /**
   * 1a. SPAWN_ROTATED -> Spawn notification for subscribed players
   */
  public async handleSpawnRotated(event: IDomainEvent<RotationTriggeredPayload>): Promise<void> {
    try {
      const { rotationNumber, activatedSpawnCount } = event.payload;
      const payload: PushNotificationPayload = {
        title: 'New Spawns Available!',
        body: `${activatedSpawnCount || 'Multiple'} new point drops are live across campus (Rotation #${rotationNumber})!`,
        data: {
          type: 'SPAWN_ROTATED',
          rotationNumber,
          timestamp: event.occurredAt.toISOString(),
        },
      };

      await this.broadcastPayload(payload);
    } catch (error) {
      console.error('[WebPushHandler] Error handling SPAWN_ROTATED:', error);
    }
  }

  /**
   * 1b. SPAWN_EXPIRED -> Spawn expiration notification
   */
  public async handleSpawnExpired(event: IDomainEvent<SpawnExpiredDomainPayload>): Promise<void> {
    try {
      const { spawnIds, spawnCode, reason } = event.payload;
      const count = spawnIds?.length || (spawnCode ? 1 : 0);
      const payload: PushNotificationPayload = {
        title: 'Spawns Expired',
        body: spawnCode
          ? `Spawn ${spawnCode} has expired.`
          : `${count || 'Some'} spawn points have expired.`,
        data: {
          type: 'SPAWN_EXPIRED',
          count,
          reason,
          timestamp: event.occurredAt.toISOString(),
        },
      };

      await this.broadcastPayload(payload);
    } catch (error) {
      console.error('[WebPushHandler] Error handling SPAWN_EXPIRED:', error);
    }
  }

  /**
   * 2. CLAIM_SUCCESS -> Personal claim confirmation push notification strictly to claiming player
   */
  public async handleClaimSuccess(event: IDomainEvent<SpawnClaimedPayload>): Promise<void> {
    try {
      const { playerId, spawnCode, pointsAwarded, claimId } = event.payload;
      if (!playerId) return;

      const payload: PushNotificationPayload = {
        title: 'Spawn Claimed!',
        body: `You claimed ${spawnCode || 'a spawn point'} and earned +${pointsAwarded} points!`,
        data: {
          type: 'CLAIM_SUCCESS',
          claimId,
          pointsAwarded,
          timestamp: event.occurredAt.toISOString(),
        },
      };

      await this.dispatchToUser(playerId, payload);
    } catch (error) {
      console.error('[WebPushHandler] Error handling CLAIM_SUCCESS:', error);
    }
  }

  /**
   * 3. RANK_CHANGED -> Personal rank-change notification strictly to affected player
   */
  public async handleRankChanged(event: IDomainEvent<RankChangedPayload>): Promise<void> {
    try {
      const { playerId, newRank, oldRank, points, period } = event.payload;
      if (!playerId) return;

      const rankText = oldRank ? `from #${oldRank} to #${newRank}` : `to #${newRank}`;
      const payload: PushNotificationPayload = {
        title: 'Rank Updated!',
        body: `Your ${period || 'weekly'} rank changed ${rankText} with ${points} points!`,
        data: {
          type: 'RANK_CHANGED',
          newRank,
          points,
          timestamp: event.occurredAt.toISOString(),
        },
      };

      await this.dispatchToUser(playerId, payload);
    } catch (error) {
      console.error('[WebPushHandler] Error handling RANK_CHANGED:', error);
    }
  }

  /**
   * 4a. RESET_APPROACHING -> Reset approaching reminder notification
   */
  public async handleResetApproaching(event: IDomainEvent<ResetApproachingPayload>): Promise<void> {
    try {
      const { minutesRemaining } = event.payload;
      const payload: PushNotificationPayload = {
        title: 'Weekly Reset Approaching!',
        body: `Only ${minutesRemaining} minutes remaining before the weekly leaderboard reset. Get your claims in!`,
        data: {
          type: 'RESET_APPROACHING',
          minutesRemaining,
          timestamp: event.occurredAt.toISOString(),
        },
      };

      await this.broadcastPayload(payload);
    } catch (error) {
      console.error('[WebPushHandler] Error handling RESET_APPROACHING:', error);
    }
  }

  /**
   * 4b. WEEKLY_RESET -> Weekly reset announcement notification
   */
  public async handleWeeklyReset(event: IDomainEvent<LeaderboardResetPayload>): Promise<void> {
    try {
      const payload: PushNotificationPayload = {
        title: 'Weekly Leaderboard Reset',
        body: 'The weekly leaderboard has been reset. Scores have reset to 0—start running for the new week!',
        data: {
          type: 'WEEKLY_RESET',
          timestamp: event.occurredAt.toISOString(),
        },
      };

      await this.broadcastPayload(payload);
    } catch (error) {
      console.error('[WebPushHandler] Error handling WEEKLY_RESET:', error);
    }
  }
}
