import { PushSubscription } from '../../domain/entities/PushSubscription';

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  data?: Record<string, any>;
}

export interface IWebPushSender {
  sendPush(subscription: PushSubscription, payload: PushNotificationPayload): Promise<boolean>;
}

export class WebPushSender implements IWebPushSender {
  constructor(
    private readonly vapidSubject: string = 'mailto:admin@campus.edu',
    private readonly publicKey?: string,
    private readonly privateKey?: string
  ) {}

  public async sendPush(subscription: PushSubscription, payload: PushNotificationPayload): Promise<boolean> {
    try {
      if (!subscription.endpoint || !subscription.endpoint.startsWith('http')) {
        console.warn(`[WebPushSender] Invalid push subscription endpoint: ${subscription.endpoint}`);
        return false;
      }

      // Minimal standard Web Push dispatch
      const body = JSON.stringify(payload);

      // In development or test environments where mock endpoints or standard endpoints are used
      const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'TTL': '86400',
        },
        body,
      }).catch((err) => {
        // Network/connection errors logged safely
        console.warn(`[WebPushSender] Network error sending push to ${subscription.endpoint}:`, err.message);
        return null;
      });

      return response ? response.ok || response.status === 201 : false;
    } catch (error) {
      console.error('[WebPushSender] Error dispatching push notification:', error);
      return false;
    }
  }
}

/**
 * In-memory test spy for Web Push sending
 */
export class InMemoryWebPushSender implements IWebPushSender {
  public sentPushes: Array<{ subscription: PushSubscription; payload: PushNotificationPayload }> = [];

  public async sendPush(subscription: PushSubscription, payload: PushNotificationPayload): Promise<boolean> {
    this.sentPushes.push({ subscription, payload });
    return true;
  }

  public clear(): void {
    this.sentPushes = [];
  }
}
