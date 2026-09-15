import crypto from 'crypto';
import { IPushSubscriptionRepository } from '../repositories/IPushSubscriptionRepository';
import { PushSubscription } from '../domain/entities/PushSubscription';
import { PushSubscriptionInputDTO, PushSubscriptionResultDTO } from './dtos';
import { ValidationError } from '../errors';

import { SchemaValidator, PushSubscriptionSchema } from '../validation';

export class SavePushSubscriptionUseCase {
  constructor(private readonly pushSubscriptionRepo: IPushSubscriptionRepository) {}

  public async execute(userId: string, input: PushSubscriptionInputDTO): Promise<PushSubscriptionResultDTO> {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new ValidationError('User ID is required');
    }

    if (!input || typeof input !== 'object') {
      throw new ValidationError('Subscription payload must be a JSON object');
    }

    const issues = SchemaValidator.validate(input as any, PushSubscriptionSchema);
    if (issues.length > 0) {
      // Find specific issue or combine
      const endpointIssue = issues.find((i) => i.field === 'endpoint');
      if (endpointIssue) {
        if (!input.endpoint || typeof input.endpoint !== 'string' || input.endpoint.trim() === '') {
          throw new ValidationError('Subscription endpoint is required', issues);
        }
        throw new ValidationError('Subscription endpoint must be a valid HTTP or HTTPS URL', issues);
      }

      const keysIssue = issues.find((i) => i.field === 'keys');
      if (keysIssue) {
        throw new ValidationError('Subscription p256dh key is required', issues);
      }

      const authIssue = issues.find((i) => i.field === 'auth');
      if (authIssue) {
        throw new ValidationError('Subscription auth key is required', issues);
      }

      throw new ValidationError('Invalid subscription payload', issues);
    }

    const endpoint = (input.endpoint as string).trim();

    let p256dh = '';
    let auth = '';

    if (input.keys && typeof input.keys === 'object') {
      if (typeof input.keys.p256dh === 'string') {
        p256dh = input.keys.p256dh.trim();
      }
      if (typeof input.keys.auth === 'string') {
        auth = input.keys.auth.trim();
      }
    }

    if (!p256dh && typeof input.p256dh === 'string') {
      p256dh = input.p256dh.trim();
    }
    if (!auth && typeof input.auth === 'string') {
      auth = input.auth.trim();
    }

    const userAgent = typeof input.userAgent === 'string' ? input.userAgent.trim() : null;

    const subscription = new PushSubscription({
      id: crypto.randomUUID(),
      userId: userId.trim(),
      endpoint,
      p256dh,
      auth,
      userAgent,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const saved = await this.pushSubscriptionRepo.saveOrUpdate(subscription);

    return {
      id: saved.id,
      endpoint: saved.endpoint,
      createdAt: saved.createdAt.toISOString(),
    };
  }
}
