import { IPushSubscriptionRepository } from '../repositories/IPushSubscriptionRepository';
import { ValidationError } from '../errors';

export interface CleanupPushSubscriptionResult {
  removed: boolean;
  endpoint: string;
  reason?: string;
}

export class CleanupPushSubscriptionUseCase {
  constructor(private readonly pushSubscriptionRepo: IPushSubscriptionRepository) {}

  /**
   * Removes an invalid, expired, or deactivated push subscription by endpoint.
   * Typically called when Web Push service responds with HTTP 404 (Not Found),
   * 410 (Gone), or invalid subscription payload.
   */
  public async execute(endpoint: string, reason?: string): Promise<CleanupPushSubscriptionResult> {
    if (!endpoint || typeof endpoint !== 'string' || endpoint.trim() === '') {
      throw new ValidationError('Subscription endpoint is required for cleanup');
    }

    const cleanEndpoint = endpoint.trim();
    const removed = await this.pushSubscriptionRepo.deleteByEndpoint(cleanEndpoint);

    return {
      removed,
      endpoint: cleanEndpoint,
      reason,
    };
  }

  /**
   * Checks if an error status code or error response indicates an invalid or expired subscription.
   * Standard Web Push RFC 8030 status codes:
   * - 404 Not Found (subscription expired / unknown)
   * - 410 Gone (subscription permanently removed / unsubscribed)
   */
  public isInvalidSubscriptionError(errorOrStatus: unknown): boolean {
    if (typeof errorOrStatus === 'number') {
      return errorOrStatus === 404 || errorOrStatus === 410;
    }

    if (errorOrStatus && typeof errorOrStatus === 'object') {
      const status = (errorOrStatus as any).statusCode || (errorOrStatus as any).status;
      if (typeof status === 'number' && (status === 404 || status === 410)) {
        return true;
      }
      const message = String((errorOrStatus as any).message || '');
      if (/410|404|notregistered|unsubscribed|invalidsubscription/i.test(message)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Conditionally cleans up a subscription if the provided error is an invalid subscription error.
   */
  public async cleanupIfInvalid(
    endpoint: string,
    errorOrStatus: unknown,
    reason?: string
  ): Promise<CleanupPushSubscriptionResult | null> {
    if (!this.isInvalidSubscriptionError(errorOrStatus)) {
      return null;
    }

    return this.execute(endpoint, reason || 'push_service_expired_or_invalid');
  }
}
