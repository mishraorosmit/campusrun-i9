import { IDomainEvent } from '../domain/events/IDomainEvent';
import { IEventBus, EventHandler } from './IEventBus';

/**
 * In-Memory Domain Event Bus
 * Dispatches domain events asynchronously to registered handlers within the process.
 */
export class InMemoryEventBus implements IEventBus {
  private handlers: Map<string, Set<EventHandler<any>>> = new Map();

  public async publish<T>(event: IDomainEvent<T>): Promise<void> {
    const eventHandlers = this.handlers.get(event.eventName);
    if (!eventHandlers || eventHandlers.size === 0) {
      return;
    }

    // Execute handlers concurrently without letting one failure crash others
    const executions = Array.from(eventHandlers).map(async (handler) => {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[EventBus] Error executing handler for event "${event.eventName}":`, error);
      }
    });

    await Promise.all(executions);
  }

  public subscribe<T>(eventName: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }

    const handlerSet = this.handlers.get(eventName)!;
    handlerSet.add(handler as EventHandler<any>);

    // Return unsubscription callback
    return () => {
      handlerSet.delete(handler as EventHandler<any>);
      if (handlerSet.size === 0) {
        this.handlers.delete(eventName);
      }
    };
  }

  public clear(): void {
    this.handlers.clear();
  }
}

// Global EventBus Singleton instance
export const eventBus = new InMemoryEventBus();
