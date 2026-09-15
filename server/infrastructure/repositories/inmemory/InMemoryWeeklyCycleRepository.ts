import { IWeeklyCycleRepository, RecordResetEventDTO } from '../../../repositories/IWeeklyCycleRepository';
import { ITransactionContext } from '../../../repositories/ITransactionManager';
import { WeeklyCycle, WeeklyCycleSettings, WeeklyResetEvent } from '../../../domain/entities';

export class InMemoryWeeklyCycleRepository implements IWeeklyCycleRepository {
  private cycles: WeeklyCycle[] = [];
  private resetEvents: Map<string, WeeklyResetEvent> = new Map();
  private settings: WeeklyCycleSettings = new WeeklyCycleSettings({
    id: 1,
    resetWeekday: 0, // Sunday
    resetTimeUtc: '23:59:00',
    updatedAt: new Date(),
  });

  constructor(
    initialCycles: WeeklyCycle[] = [],
    initialSettings?: WeeklyCycleSettings,
    initialResetEvents: WeeklyResetEvent[] = []
  ) {
    this.cycles = [...initialCycles];
    if (initialSettings) {
      this.settings = initialSettings;
    }
    for (const event of initialResetEvents) {
      this.resetEvents.set(event.resetKey, event);
    }
  }

  async getActiveCycle(): Promise<WeeklyCycle | null> {
    const active = this.cycles.find((c) => c.status === 'active' && !c.completedAt);
    return active || null;
  }

  async getActiveCycleTx(_tx: ITransactionContext, _forUpdate = false): Promise<WeeklyCycle | null> {
    return this.getActiveCycle();
  }

  async createCycle(cycle: { startsAt: Date; endsAt: Date; status: string }): Promise<WeeklyCycle> {
    const newCycle = new WeeklyCycle({
      id: `cycle-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
      status: cycle.status as any,
      createdAt: new Date(),
      completedAt: null,
    });
    this.cycles.push(newCycle);
    return newCycle;
  }

  async createCycleTx(
    cycle: { startsAt: Date; endsAt: Date; status: string },
    _tx: ITransactionContext
  ): Promise<WeeklyCycle> {
    return this.createCycle(cycle);
  }

  async completeCycleTx(cycleId: string, _tx: ITransactionContext, completedAt: Date = new Date()): Promise<void> {
    const index = this.cycles.findIndex((c) => c.id === cycleId);
    if (index !== -1) {
      const current = this.cycles[index];
      this.cycles[index] = new WeeklyCycle({
        ...current.props,
        status: 'completed',
        completedAt,
      });
    }
  }

  async recordResetEventTx(event: RecordResetEventDTO, _tx: ITransactionContext): Promise<boolean> {
    if (this.resetEvents.has(event.resetKey)) {
      return false; // Unique constraint violation simulation
    }

    const resetEvent = new WeeklyResetEvent({
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      cycleId: event.cycleId,
      resetKey: event.resetKey,
      resetType: event.resetType,
      triggeredByProfileId: event.triggeredByProfileId,
      executedAt: event.executedAt || new Date(),
    });

    this.resetEvents.set(event.resetKey, resetEvent);
    return true;
  }

  async getResetEventByKey(resetKey: string, _tx?: ITransactionContext): Promise<WeeklyResetEvent | null> {
    return this.resetEvents.get(resetKey) || null;
  }

  async getSettings(): Promise<WeeklyCycleSettings | null> {
    return this.settings;
  }

  async getSettingsTx(_tx?: ITransactionContext): Promise<WeeklyCycleSettings | null> {
    return this.settings;
  }

  setSettings(settings: WeeklyCycleSettings): void {
    this.settings = settings;
  }

  clear(): void {
    this.cycles = [];
    this.resetEvents.clear();
  }
}
