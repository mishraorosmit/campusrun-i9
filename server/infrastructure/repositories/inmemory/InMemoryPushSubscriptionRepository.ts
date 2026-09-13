import { IPushSubscriptionRepository } from '../../../repositories/IPushSubscriptionRepository';
import { PushSubscription } from '../../../domain/entities/PushSubscription';

export class InMemoryPushSubscriptionRepository implements IPushSubscriptionRepository {
  private subscriptions: Map<string, PushSubscription> = new Map();

  constructor(initialSubscriptions: PushSubscription[] = []) {
    for (const sub of initialSubscriptions) {
      this.subscriptions.set(sub.id, sub);
    }
  }

  public async saveOrUpdate(subscription: PushSubscription): Promise<PushSubscription> {
    let existingEntry: [string, PushSubscription] | undefined;
    for (const [id, sub] of this.subscriptions.entries()) {
      if (sub.endpoint === subscription.endpoint) {
        existingEntry = [id, sub];
        break;
      }
    }

    if (existingEntry) {
      const [existingId, existingSub] = existingEntry;
      const updated = new PushSubscription({
        id: existingId,
        userId: subscription.userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        userAgent: subscription.userAgent !== undefined ? subscription.userAgent : existingSub.userAgent,
        createdAt: existingSub.createdAt,
        updatedAt: new Date(),
      });
      this.subscriptions.set(existingId, updated);
      return updated;
    }

    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  public async findByEndpoint(endpoint: string): Promise<PushSubscription | null> {
    for (const sub of this.subscriptions.values()) {
      if (sub.endpoint === endpoint) {
        return sub;
      }
    }
    return null;
  }

  public async findById(id: string): Promise<PushSubscription | null> {
    return this.subscriptions.get(id) || null;
  }

  public async findByUserId(userId: string): Promise<PushSubscription[]> {
    return Array.from(this.subscriptions.values()).filter((sub) => sub.userId === userId);
  }

  public async findAll(): Promise<PushSubscription[]> {
    return Array.from(this.subscriptions.values());
  }

  public async deleteByEndpoint(endpoint: string): Promise<boolean> {
    for (const [id, sub] of this.subscriptions.entries()) {
      if (sub.endpoint === endpoint) {
        this.subscriptions.delete(id);
        return true;
      }
    }
    return false;
  }

  public async deleteByEndpointAndUserId(endpoint: string, userId: string): Promise<boolean> {
    for (const [id, sub] of this.subscriptions.entries()) {
      if (sub.endpoint === endpoint && sub.userId === userId) {
        this.subscriptions.delete(id);
        return true;
      }
    }
    return false;
  }

  public async deleteByIdAndUserId(id: string, userId: string): Promise<boolean> {
    const sub = this.subscriptions.get(id);
    if (sub && sub.userId === userId) {
      this.subscriptions.delete(id);
      return true;
    }
    return false;
  }
}
