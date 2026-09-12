import { IDomainEvent } from '../domain/events/IDomainEvent';

export type EventHandler<T = unknown> = (event: IDomainEvent<T>) => Promise<void> | void;

export interface IEventBus {
  publish<T>(event: IDomainEvent<T>): Promise<void>;
  subscribe<T>(eventName: string, handler: EventHandler<T>): () => void;
  clear(): void;
}
