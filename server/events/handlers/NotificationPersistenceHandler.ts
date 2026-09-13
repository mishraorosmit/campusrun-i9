import { randomUUID } from 'crypto';
import { IEventBus } from '../IEventBus';
import { INotificationRepository } from '../../repositories/INotificationRepository';
import { IPlayerRepository } from '../../repositories/IPlayerRepository';
import { Notification } from '../../domain/entities/Notification';
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
 * NotificationPersistenceHandler
 * Subscribes to the internal Domain Event Bus and automatically persists notification
 * records into the database.
 *
 * Fault Isolation: Handler errors are caught and logged; failures never crash the event bus.
 * Boundaries: Strictly creates DB rows; does NOT send realtime or browser push notifications.
 */
export class NotificationPersistenceHandler {
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly eventBus: IEventBus,
    private readonly notificationRepo: INotificationRepository,
    private readonly playerRepo?: IPlayerRepository
  ) {
    this.register();
  }

  /**
   * Subscribes to domain events on the internal event bus.
   */
  public register(): void {
    this.unregister(); // Prevent duplicate subscriptions if re-registered

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
      this.eventBus.subscribe<LeaderboardResetPayload>(
        DOMAIN_EVENT_NAMES.WEEKLY_RESET,
        this.handleWeeklyReset.bind(this)
      )
    );

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
      this.eventBus.subscribe<ResetApproachingPayload>(
        DOMAIN_EVENT_NAMES.RESET_APPROACHING,
        this.handleResetApproaching.bind(this)
      )
    );
  }

  /**
   * Unsubscribes all registered event listeners.
   */
  public unregister(): void {
    for (const unsubscribe of this.unsubscribers) {
      try {
        unsubscribe();
      } catch (err) {
        console.error('[NotificationPersistenceHandler] Error during unsubscribe:', err);
      }
    }
    this.unsubscribers = [];
  }

  /**
   * 1. SpawnClaimedEvent -> type: 'CLAIM_SUCCESS', entity_type: 'claim', entity_id: claimId
   */
  public async handleClaimSuccess(event: IDomainEvent<SpawnClaimedPayload>): Promise<void> {
    try {
      const { playerId, spawnCode, pointsAwarded, claimId } = event.payload;
      if (!playerId) return;

      const notification = new Notification({
        id: randomUUID(),
        userId: playerId,
        type: 'CLAIM_SUCCESS',
        title: 'Spawn Claimed!',
        body: `You claimed ${spawnCode || 'a spawn point'} and earned +${pointsAwarded} points!`,
        read: false,
        readAt: null,
        entityType: 'claim',
        entityId: claimId || null,
        createdAt: event.occurredAt || new Date(),
      });

      await this.notificationRepo.save(notification);
    } catch (error) {
      console.error('[NotificationPersistenceHandler] Error handling CLAIM_SUCCESS event:', error);
    }
  }

  /**
   * 2. RankChangedEvent -> type: 'RANK_CHANGED', entity_type: 'leaderboard', entity_id: userId
   */
  public async handleRankChanged(event: IDomainEvent<RankChangedPayload>): Promise<void> {
    try {
      const { playerId, newRank, oldRank, points, period } = event.payload;
      if (!playerId) return;

      const rankText = oldRank ? `from #${oldRank} to #${newRank}` : `to #${newRank}`;
      const notification = new Notification({
        id: randomUUID(),
        userId: playerId,
        type: 'RANK_CHANGED',
        title: 'Leaderboard Rank Updated',
        body: `Your ${period || 'weekly'} rank changed ${rankText} with ${points} points!`,
        read: false,
        readAt: null,
        entityType: 'leaderboard',
        entityId: playerId,
        createdAt: event.occurredAt || new Date(),
      });

      await this.notificationRepo.save(notification);
    } catch (error) {
      console.error('[NotificationPersistenceHandler] Error handling RANK_CHANGED event:', error);
    }
  }

  /**
   * 3. LeaderboardResetEvent -> type: 'WEEKLY_RESET', entity_type: 'cycle', entity_id: cycleId
   */
  public async handleWeeklyReset(event: IDomainEvent<LeaderboardResetPayload>): Promise<void> {
    try {
      const userIds = await this.getAllUserIds();
      if (!userIds || userIds.length === 0) return;

      const { cycleId } = event.payload;
      const notifications = userIds.map(
        (userId) =>
          new Notification({
            id: randomUUID(),
            userId,
            type: 'WEEKLY_RESET',
            title: 'Weekly Leaderboard Reset',
            body: 'The weekly leaderboard has been reset. Scores have reset to 0—start running for the new week!',
            read: false,
            readAt: null,
            entityType: 'cycle',
            entityId: cycleId || null,
            createdAt: event.occurredAt || new Date(),
          })
      );

      await this.saveNotifications(notifications);
    } catch (error) {
      console.error('[NotificationPersistenceHandler] Error handling WEEKLY_RESET event:', error);
    }
  }

  /**
   * 4. RotationTriggeredEvent -> type: 'SPAWN_ROTATED', entity_type: 'spawn', entity_id: rotationId
   */
  public async handleSpawnRotated(event: IDomainEvent<RotationTriggeredPayload>): Promise<void> {
    try {
      const userIds = await this.getAllUserIds();
      if (!userIds || userIds.length === 0) return;

      const { rotationNumber, activatedSpawnCount, rotationId } = event.payload;
      const notifications = userIds.map(
        (userId) =>
          new Notification({
            id: randomUUID(),
            userId,
            type: 'SPAWN_ROTATED',
            title: 'New Spawns Available!',
            body: `${activatedSpawnCount || 'Multiple'} new point drops have spawned across campus (Rotation #${rotationNumber})!`,
            read: false,
            readAt: null,
            entityType: 'spawn',
            entityId: rotationId || null,
            createdAt: event.occurredAt || new Date(),
          })
      );

      await this.saveNotifications(notifications);
    } catch (error) {
      console.error('[NotificationPersistenceHandler] Error handling SPAWN_ROTATED event:', error);
    }
  }

  /**
   * 5. SpawnExpiredEvent -> type: 'SPAWN_EXPIRED', entity_type: 'spawn', entity_id: spawnId
   */
  public async handleSpawnExpired(event: IDomainEvent<SpawnExpiredDomainPayload>): Promise<void> {
    try {
      const userIds = await this.getAllUserIds();
      if (!userIds || userIds.length === 0) return;

      const { spawnCode, spawnId, reason } = event.payload;
      const targetCode = spawnCode || spawnId || 'A point drop';
      const notifications = userIds.map(
        (userId) =>
          new Notification({
            id: randomUUID(),
            userId,
            type: 'SPAWN_EXPIRED',
            title: 'Spawn Expired',
            body: `Spawn point "${targetCode}" is no longer active (${reason || 'expired'}).`,
            read: false,
            readAt: null,
            entityType: 'spawn',
            entityId: spawnId || null,
            createdAt: event.occurredAt || new Date(),
          })
      );

      await this.saveNotifications(notifications);
    } catch (error) {
      console.error('[NotificationPersistenceHandler] Error handling SPAWN_EXPIRED event:', error);
    }
  }

  /**
   * 6. ResetApproachingEvent -> type: 'RESET_APPROACHING', entity_type: 'cycle', entity_id: cycleId
   */
  public async handleResetApproaching(event: IDomainEvent<ResetApproachingPayload>): Promise<void> {
    try {
      const userIds = await this.getAllUserIds();
      if (!userIds || userIds.length === 0) return;

      const { minutesRemaining, cycleId } = event.payload;
      const notifications = userIds.map(
        (userId) =>
          new Notification({
            id: randomUUID(),
            userId,
            type: 'RESET_APPROACHING',
            title: 'Weekly Reset Approaching!',
            body: `The weekly leaderboard will reset in ${minutesRemaining} minutes. Get your final claims in!`,
            read: false,
            readAt: null,
            entityType: 'cycle',
            entityId: cycleId || null,
            createdAt: event.occurredAt || new Date(),
          })
      );

      await this.saveNotifications(notifications);
    } catch (error) {
      console.error('[NotificationPersistenceHandler] Error handling RESET_APPROACHING event:', error);
    }
  }

  private async getAllUserIds(): Promise<string[]> {
    if (this.playerRepo?.findAllUserIds) {
      return this.playerRepo.findAllUserIds();
    }
    if (this.playerRepo?.findAll) {
      const players = await this.playerRepo.findAll();
      return players.map((p) => p.id);
    }
    return [];
  }

  private async saveNotifications(notifications: Notification[]): Promise<void> {
    if (notifications.length === 0) return;

    if (this.notificationRepo.saveBatch) {
      await this.notificationRepo.saveBatch(notifications);
    } else {
      for (const notif of notifications) {
        await this.notificationRepo.save(notif);
      }
    }
  }
}

