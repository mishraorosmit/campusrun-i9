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
 * DatabaseNotificationHandler
 * Subscribes to the internal Domain Event Bus and persists in-app notification
 * records into the PostgreSQL `notifications` table.
 *
 * Fault Tolerance: All handler errors are caught and logged; failures never crash the event bus.
 * Boundaries: Strictly creates DB rows; does NOT send realtime or push notifications.
 */
export class DatabaseNotificationHandler {
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly eventBus: IEventBus,
    private readonly notificationRepo: INotificationRepository,
    private readonly playerRepo?: IPlayerRepository
  ) {
    this.register();
  }

  /**
   * Subscribes to the 6 mapped domain events on the event bus.
   */
  public register(): void {
    this.unregister(); // Prevent duplicate subscriptions if re-registered

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

  /**
   * Unsubscribes all registered event listeners.
   */
  public unregister(): void {
    for (const unsubscribe of this.unsubscribers) {
      try {
        unsubscribe();
      } catch (err) {
        console.error('[DatabaseNotificationHandler] Error during unsubscribe:', err);
      }
    }
    this.unsubscribers = [];
  }

  /**
   * 1. SPAWN_ROTATED -> Broadcast notification for global/active players
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
            type: 'spawn_rotation',
            title: 'New Spawns Available!',
            body: `${activatedSpawnCount || 'Multiple'} new point drops have spawned across campus (Rotation #${rotationNumber})!`,
            read: false,
            readAt: null,
            entityType: 'spawn_batch',
            entityId: this.isValidUuid(rotationId) ? rotationId : null,
            createdAt: event.occurredAt || new Date(),
          })
      );

      await this.saveNotifications(notifications);
    } catch (error) {
      console.error('[DatabaseNotificationHandler] Error handling SPAWN_ROTATED event:', error);
    }
  }

  /**
   * 2. SPAWN_EXPIRED -> Notification where applicable
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
            type: 'spawn_rotation',
            title: 'Spawn Expired',
            body: `Spawn point "${targetCode}" is no longer active (${reason || 'expired'}).`,
            read: false,
            readAt: null,
            entityType: 'spawn_point',
            entityId: this.isValidUuid(spawnId) ? spawnId : null,
            createdAt: event.occurredAt || new Date(),
          })
      );

      await this.saveNotifications(notifications);
    } catch (error) {
      console.error('[DatabaseNotificationHandler] Error handling SPAWN_EXPIRED event:', error);
    }
  }

  /**
   * 3. CLAIM_SUCCESS -> Personal notification strictly to the claiming player
   */
  public async handleClaimSuccess(event: IDomainEvent<SpawnClaimedPayload>): Promise<void> {
    try {
      const { playerId, spawnCode, pointsAwarded, claimId } = event.payload;
      if (!playerId) return;

      const notification = new Notification({
        id: randomUUID(),
        userId: playerId,
        type: 'claim_reward',
        title: 'Spawn Claimed!',
        body: `You claimed ${spawnCode || 'a spawn point'} and earned +${pointsAwarded} points!`,
        read: false,
        readAt: null,
        entityType: 'claim',
        entityId: this.isValidUuid(claimId) ? claimId : null,
        createdAt: event.occurredAt || new Date(),
      });

      await this.notificationRepo.save(notification);
    } catch (error) {
      console.error('[DatabaseNotificationHandler] Error handling CLAIM_SUCCESS event:', error);
    }
  }

  /**
   * 4. RANK_CHANGED -> Personal notification strictly to the affected player
   */
  public async handleRankChanged(event: IDomainEvent<RankChangedPayload>): Promise<void> {
    try {
      const { playerId, newRank, oldRank, points, period } = event.payload;
      if (!playerId) return;

      const rankText = oldRank ? `from #${oldRank} to #${newRank}` : `to #${newRank}`;
      const notification = new Notification({
        id: randomUUID(),
        userId: playerId,
        type: 'leaderboard_rank',
        title: 'Leaderboard Rank Updated',
        body: `Your ${period || 'weekly'} rank changed ${rankText} with ${points} points!`,
        read: false,
        readAt: null,
        entityType: 'weekly_cycle',
        entityId: null,
        createdAt: event.occurredAt || new Date(),
      });

      await this.notificationRepo.save(notification);
    } catch (error) {
      console.error('[DatabaseNotificationHandler] Error handling RANK_CHANGED event:', error);
    }
  }

  /**
   * 5. RESET_APPROACHING -> Notification for players near weekly cycle reset
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
            type: 'streak_reminder',
            title: 'Weekly Reset Approaching!',
            body: `The weekly leaderboard will reset in ${minutesRemaining} minutes. Get your final claims in!`,
            read: false,
            readAt: null,
            entityType: 'weekly_cycle',
            entityId: this.isValidUuid(cycleId) ? cycleId : null,
            createdAt: event.occurredAt || new Date(),
          })
      );

      await this.saveNotifications(notifications);
    } catch (error) {
      console.error('[DatabaseNotificationHandler] Error handling RESET_APPROACHING event:', error);
    }
  }

  /**
   * 6. WEEKLY_RESET -> Global notification for weekly cycle reset
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
            type: 'system_announcement',
            title: 'Weekly Leaderboard Reset',
            body: 'The weekly leaderboard has been reset. Scores have reset to 0—start running for the new week!',
            read: false,
            readAt: null,
            entityType: 'weekly_cycle',
            entityId: this.isValidUuid(cycleId) ? cycleId : null,
            createdAt: event.occurredAt || new Date(),
          })
      );

      await this.saveNotifications(notifications);
    } catch (error) {
      console.error('[DatabaseNotificationHandler] Error handling WEEKLY_RESET event:', error);
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

  private isValidUuid(id?: string | null): boolean {
    if (!id) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }
}
