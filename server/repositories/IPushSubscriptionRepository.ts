import { PushSubscription } from '../domain/entities/PushSubscription';

export interface IPushSubscriptionRepository {
  saveOrUpdate(subscription: PushSubscription): Promise<PushSubscription>;
  findByEndpoint(endpoint: string): Promise<PushSubscription | null>;
  findById(id: string): Promise<PushSubscription | null>;
  findByUserId(userId: string): Promise<PushSubscription[]>;
  findAll(): Promise<PushSubscription[]>;
  deleteByEndpoint(endpoint: string): Promise<boolean>;
  deleteByEndpointAndUserId(endpoint: string, userId: string): Promise<boolean>;
  deleteByIdAndUserId(id: string, userId: string): Promise<boolean>;
}

