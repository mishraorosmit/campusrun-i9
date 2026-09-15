import { IPushSubscriptionRepository } from '../repositories/IPushSubscriptionRepository';
import { NotFoundError, ValidationError } from '../errors';

export interface DeletePushSubscriptionInput {
  endpoint?: string;
  id?: string;
  subscriptionId?: string;
}

export class DeletePushSubscriptionUseCase {
  constructor(private readonly pushSubscriptionRepo: IPushSubscriptionRepository) {}

  public async execute(userId: string, input: DeletePushSubscriptionInput | string): Promise<{ success: boolean; message: string }> {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new ValidationError('User ID is required');
    }

    let endpoint: string | undefined;
    let id: string | undefined;

    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        endpoint = trimmed;
      } else {
        id = trimmed;
      }
    } else if (input && typeof input === 'object') {
      if (typeof input.endpoint === 'string' && input.endpoint.trim() !== '') {
        endpoint = input.endpoint.trim();
      }
      if (typeof input.id === 'string' && input.id.trim() !== '') {
        id = input.id.trim();
      }
      if (typeof input.subscriptionId === 'string' && input.subscriptionId.trim() !== '') {
        id = input.subscriptionId.trim();
      }
    }

    if (!endpoint && !id) {
      throw new ValidationError('Subscription endpoint or ID is required for deletion');
    }

    let deleted = false;
    const cleanUserId = userId.trim();

    if (endpoint) {
      deleted = await this.pushSubscriptionRepo.deleteByEndpointAndUserId(endpoint, cleanUserId);
    }

    if (!deleted && id) {
      deleted = await this.pushSubscriptionRepo.deleteByIdAndUserId(id, cleanUserId);
    }

    if (!deleted) {
      throw new NotFoundError('Push subscription not found');
    }

    return {
      success: true,
      message: 'Push subscription deleted successfully',
    };
  }

  /**
   * Directly removes a subscription by endpoint (e.g. system cleanup when endpoint is expired/invalid).
   */
  public async deleteByEndpoint(endpoint: string): Promise<boolean> {
    if (!endpoint || typeof endpoint !== 'string' || endpoint.trim() === '') {
      throw new ValidationError('Subscription endpoint is required for deletion');
    }
    return this.pushSubscriptionRepo.deleteByEndpoint(endpoint.trim());
  }
}
