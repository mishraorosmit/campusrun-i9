import webpush from 'web-push';
import { IPushSubscriptionRepository } from '../repositories/IPushSubscriptionRepository';
import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { PushSubscription } from '../domain/entities/PushSubscription';
import { config } from '../config';

export interface PushNotificationPayload {
  title?: string;
  body?: string;
  icon?: string;
  badge?: string;
  url?: string;
  data?: Record<string, any>;
  [key: string]: any;
}

export interface PushDeliverySummary {
  userId: string;
  skipped: boolean;
  skipReason?: string;
  totalSubscriptions: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  removedEndpoints: string[];
}

export interface VapidConfiguration {
  vapidSubject?: string;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
}

export interface PushThrottleOptions {
  /**
   * Deduplication window in milliseconds.
   * Prevents sending same user + same event + same entity within this window.
   * Default: 60,000 ms (1 minute).
   */
  dedupWindowMs?: number;

  /**
   * Rolling window for per-user rate limiting in milliseconds.
   * Default: 60,000 ms (1 minute).
   */
  rateLimitWindowMs?: number;

  /**
   * Maximum notifications allowed per user within rateLimitWindowMs.
   * Default: 10 notifications.
   */
  maxNotificationsPerWindow?: number;

  /**
   * Enable/disable deduplication. Default: true.
   */
  enableDeduplication?: boolean;

  /**
   * Enable/disable rate limiting. Default: true.
   */
  enableRateLimiting?: boolean;
}

export type PushSendFn = (
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  },
  payload: string,
  options?: webpush.RequestOptions
) => Promise<any>;

export class PushDeliveryService {
  private readonly vapidSubject: string;
  private readonly vapidPublicKey?: string;
  private readonly vapidPrivateKey?: string;
  private isVapidConfigured = false;
  private readonly sendNotificationFn: PushSendFn;

  // Throttle & Deduplication Configuration
  private readonly dedupWindowMs: number;
  private readonly rateLimitWindowMs: number;
  private readonly maxNotificationsPerWindow: number;
  private readonly enableDeduplication: boolean;
  private readonly enableRateLimiting: boolean;

  // In-Memory state for Deduplication and Rate Limiting
  private readonly dedupStore = new Map<string, number>(); // dedupKey -> lastSentTimestamp
  private readonly rateLimitStore = new Map<string, number[]>(); // userId -> array of timestamps
  private lastPruneTimestamp = Date.now();

  constructor(
    private readonly pushSubscriptionRepo: IPushSubscriptionRepository,
    private readonly playerRepo?: IPlayerRepository,
    vapidConfig?: VapidConfiguration,
    customSender?: PushSendFn,
    throttleOptions?: PushThrottleOptions
  ) {
    this.vapidSubject =
      vapidConfig?.vapidSubject ||
      process.env.VAPID_SUBJECT ||
      config?.VAPID_SUBJECT ||
      'mailto:admin@campus.edu';

    this.vapidPublicKey =
      vapidConfig?.vapidPublicKey ||
      process.env.VAPID_PUBLIC_KEY ||
      config?.VAPID_PUBLIC_KEY ||
      undefined;

    this.vapidPrivateKey =
      vapidConfig?.vapidPrivateKey ||
      process.env.VAPID_PRIVATE_KEY ||
      config?.VAPID_PRIVATE_KEY ||
      undefined;

    this.sendNotificationFn = customSender || webpush.sendNotification.bind(webpush);

    // Throttle settings
    this.dedupWindowMs = throttleOptions?.dedupWindowMs ?? 60_000;
    this.rateLimitWindowMs = throttleOptions?.rateLimitWindowMs ?? 60_000;
    this.maxNotificationsPerWindow = throttleOptions?.maxNotificationsPerWindow ?? 10;
    this.enableDeduplication = throttleOptions?.enableDeduplication ?? true;
    this.enableRateLimiting = throttleOptions?.enableRateLimiting ?? true;

    this.initVapid();
  }

  private initVapid(): void {
    if (this.vapidPublicKey && this.vapidPrivateKey) {
      try {
        webpush.setVapidDetails(this.vapidSubject, this.vapidPublicKey, this.vapidPrivateKey);
        this.isVapidConfigured = true;
      } catch (err) {
        console.error('[PushDeliveryService] Failed to configure VAPID credentials:', err);
      }
    }
  }

  /**
   * Generates a unique deduplication key based on user + event type + entity identifier.
   */
  public generateDedupKey(
    userId: string,
    payload: PushNotificationPayload | Record<string, any> | string
  ): string {
    let parsedPayload: any = payload;
    if (typeof payload === 'string') {
      try {
        parsedPayload = JSON.parse(payload);
      } catch {
        parsedPayload = { title: payload };
      }
    }

    const data = parsedPayload?.data || {};
    const eventType = data.type || parsedPayload?.type || parsedPayload?.title || 'generic';
    const entityId =
      data.claimId ||
      data.spawnId ||
      data.rotationNumber ||
      data.cycleId ||
      data.newRank ||
      data.minutesRemaining ||
      parsedPayload?.id ||
      '';

    return `dedup:${userId}:${eventType}:${entityId}`;
  }

  /**
   * Checks if a notification is a duplicate within the deduplication window.
   */
  public isDuplicate(dedupKey: string, now: number = Date.now()): boolean {
    if (!this.enableDeduplication) {
      return false;
    }

    const lastSent = this.dedupStore.get(dedupKey);
    if (lastSent && now - lastSent < this.dedupWindowMs) {
      return true;
    }

    return false;
  }

  /**
   * Checks if a user has exceeded the maximum rate limit within the rolling window.
   */
  public isRateLimited(userId: string, now: number = Date.now()): boolean {
    if (!this.enableRateLimiting) {
      return false;
    }

    const timestamps = this.rateLimitStore.get(userId) || [];
    const recentTimestamps = timestamps.filter((t) => now - t < this.rateLimitWindowMs);

    return recentTimestamps.length >= this.maxNotificationsPerWindow;
  }

  /**
   * Records a successfully accepted notification delivery in dedup and rate-limit stores.
   */
  private recordDelivery(userId: string, dedupKey: string, now: number = Date.now()): void {
    if (this.enableDeduplication) {
      this.dedupStore.set(dedupKey, now);
    }

    if (this.enableRateLimiting) {
      const timestamps = this.rateLimitStore.get(userId) || [];
      const recentTimestamps = timestamps.filter((t) => now - t < this.rateLimitWindowMs);
      recentTimestamps.push(now);
      this.rateLimitStore.set(userId, recentTimestamps);
    }

    // Prune stale entries if more than 30 seconds since last prune or store grows
    if (now - this.lastPruneTimestamp > 30_000 || this.dedupStore.size > 500) {
      this.pruneExpiredEntries(now);
    }
  }

  /**
   * Cleans up expired deduplication entries and rate-limit timestamps so memory stays bounded.
   */
  public pruneExpiredEntries(now: number = Date.now()): void {
    // 1. Prune dedup entries
    for (const [key, timestamp] of this.dedupStore.entries()) {
      if (now - timestamp >= this.dedupWindowMs) {
        this.dedupStore.delete(key);
      }
    }

    // 2. Prune rate limit entries
    for (const [user, timestamps] of this.rateLimitStore.entries()) {
      const active = timestamps.filter((t) => now - t < this.rateLimitWindowMs);
      if (active.length === 0) {
        this.rateLimitStore.delete(user);
      } else {
        this.rateLimitStore.set(user, active);
      }
    }

    this.lastPruneTimestamp = now;
  }

  /**
   * Clears in-memory deduplication and rate-limiting stores (primarily for testing).
   */
  public clearThrottleState(): void {
    this.dedupStore.clear();
    this.rateLimitStore.clear();
    this.lastPruneTimestamp = Date.now();
  }

  /**
   * Checks if push notifications are enabled for the given user.
   * If the user set push notifications to false in their preferences, returns false.
   */
  public async isPushEnabledForUser(userId: string): Promise<boolean> {
    if (!this.playerRepo) {
      return true;
    }

    try {
      const player = await this.playerRepo.findById(userId);
      if (!player) {
        return true;
      }

      const prefs = player.preferences || {};
      if (
        prefs.pushNotificationsEnabled === false ||
        prefs.pushNotifications === false ||
        prefs.notificationsEnabled === false ||
        prefs.pushEnabled === false
      ) {
        return false;
      }

      return true;
    } catch (err) {
      console.warn(`[PushDeliveryService] Error checking user preferences for ${userId}:`, err);
      return true;
    }
  }

  /**
   * Sends a push notification payload to all valid subscriptions belonging to a user.
   * Applies user preferences, deduplication, and per-user rolling rate limits.
   */
  public async sendToUser(
    userId: string,
    payload: PushNotificationPayload | Record<string, any> | string
  ): Promise<PushDeliverySummary> {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      return {
        userId,
        skipped: true,
        skipReason: 'invalid_user_id',
        totalSubscriptions: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        removedEndpoints: [],
      };
    }

    const cleanUserId = userId.trim();
    const now = Date.now();

    // 1. Check user notification preferences
    const isEnabled = await this.isPushEnabledForUser(cleanUserId);
    if (!isEnabled) {
      return {
        userId: cleanUserId,
        skipped: true,
        skipReason: 'push_disabled_by_user_preference',
        totalSubscriptions: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        removedEndpoints: [],
      };
    }

    // 2. Check Deduplication (same user + event type + entity in short window)
    const dedupKey = this.generateDedupKey(cleanUserId, payload);
    if (this.isDuplicate(dedupKey, now)) {
      console.log(`[PushDeliveryService] Duplicate push suppressed for key: ${dedupKey}`);
      return {
        userId: cleanUserId,
        skipped: true,
        skipReason: 'duplicate_suppressed',
        totalSubscriptions: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        removedEndpoints: [],
      };
    }

    // 3. Check Per-User Rate Limit (rolling window spam prevention)
    if (this.isRateLimited(cleanUserId, now)) {
      console.warn(
        `[PushDeliveryService] Rate limit exceeded for user ${cleanUserId} (max ${this.maxNotificationsPerWindow} per ${this.rateLimitWindowMs}ms)`
      );
      return {
        userId: cleanUserId,
        skipped: true,
        skipReason: 'rate_limited',
        totalSubscriptions: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        removedEndpoints: [],
      };
    }

    // 4. Retrieve user subscriptions from repository
    let subscriptions: PushSubscription[] = [];
    try {
      subscriptions = await this.pushSubscriptionRepo.findByUserId(cleanUserId);
    } catch (err) {
      console.error(`[PushDeliveryService] Error fetching subscriptions for user ${cleanUserId}:`, err);
      return {
        userId: cleanUserId,
        skipped: false,
        totalSubscriptions: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        removedEndpoints: [],
      };
    }

    if (!subscriptions || subscriptions.length === 0) {
      return {
        userId: cleanUserId,
        skipped: false,
        totalSubscriptions: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        removedEndpoints: [],
      };
    }

    // 5. Record delivery timestamp for deduplication and rate limiting
    this.recordDelivery(cleanUserId, dedupKey, now);

    // 6. Deliver to each subscription independently (fault isolation)
    let successfulDeliveries = 0;
    let failedDeliveries = 0;
    const removedEndpoints: string[] = [];

    const deliveryPromises = subscriptions.map(async (subscription) => {
      try {
        const res = await this.sendToSubscription(subscription, payload);
        if (res.success) {
          successfulDeliveries++;
        } else {
          failedDeliveries++;
          if (res.removed) {
            removedEndpoints.push(subscription.endpoint);
          }
        }
      } catch (err) {
        failedDeliveries++;
        console.error(
          `[PushDeliveryService] Uncaught error delivering push to ${subscription.endpoint}:`,
          err
        );
      }
    });

    await Promise.allSettled(deliveryPromises);

    return {
      userId: cleanUserId,
      skipped: false,
      totalSubscriptions: subscriptions.length,
      successfulDeliveries,
      failedDeliveries,
      removedEndpoints,
    };
  }

  /**
   * Sends a notification payload to a single push subscription.
   * Handles 404/410 errors by cleaning up the invalid subscription from the database.
   */
  public async sendToSubscription(
    subscription: PushSubscription,
    payload: PushNotificationPayload | Record<string, any> | string
  ): Promise<{ success: boolean; removed: boolean; error?: string }> {
    if (!subscription || !subscription.endpoint || !subscription.p256dh || !subscription.auth) {
      console.warn('[PushDeliveryService] Incomplete subscription payload, skipping delivery');
      return { success: false, removed: false, error: 'incomplete_subscription' };
    }

    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

    try {
      const pushSubscriptionObject = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      };

      await this.sendNotificationFn(pushSubscriptionObject, payloadString, {
        TTL: 86400,
      });

      return { success: true, removed: false };
    } catch (err: any) {
      const statusCode = err?.statusCode || err?.status;
      const isExpiredOrInvalid =
        statusCode === 404 ||
        statusCode === 410 ||
        (typeof err?.message === 'string' && /404|410|notregistered|unsubscribed/i.test(err.message));

      if (isExpiredOrInvalid) {
        console.warn(
          `[PushDeliveryService] Push endpoint returned ${statusCode || 410} (invalid/expired), removing subscription: ${subscription.endpoint}`
        );
        try {
          await this.pushSubscriptionRepo.deleteByEndpoint(subscription.endpoint);
        } catch (cleanupErr) {
          console.error(
            `[PushDeliveryService] Error removing expired subscription ${subscription.endpoint}:`,
            cleanupErr
          );
        }
        return { success: false, removed: true, error: err?.message || 'subscription_expired' };
      }

      console.error(
        `[PushDeliveryService] Error dispatching push to ${subscription.endpoint}:`,
        err?.message || err
      );
      return { success: false, removed: false, error: err?.message || String(err) };
    }
  }
}

export { PushDeliveryService as WebPushService };
