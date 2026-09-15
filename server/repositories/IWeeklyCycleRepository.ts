import { WeeklyCycle, WeeklyCycleSettings, WeeklyResetEvent } from '../domain/entities';
import { ITransactionContext } from './ITransactionManager';

export interface RecordResetEventDTO {
  cycleId: string;
  resetKey: string;
  resetType: 'scheduled' | 'manual';
  triggeredByProfileId?: string | null;
  executedAt?: Date;
}

export interface IWeeklyCycleRepository {
  getActiveCycle(): Promise<WeeklyCycle | null>;
  getActiveCycleTx(tx: ITransactionContext, forUpdate?: boolean): Promise<WeeklyCycle | null>;
  createCycle(cycle: { startsAt: Date; endsAt: Date; status: string }): Promise<WeeklyCycle>;
  createCycleTx(cycle: { startsAt: Date; endsAt: Date; status: string }, tx: ITransactionContext): Promise<WeeklyCycle>;
  completeCycleTx(cycleId: string, tx: ITransactionContext, completedAt?: Date): Promise<void>;
  recordResetEventTx(event: RecordResetEventDTO, tx: ITransactionContext): Promise<boolean>;
  getResetEventByKey(resetKey: string, tx?: ITransactionContext): Promise<WeeklyResetEvent | null>;
  getSettings(): Promise<WeeklyCycleSettings | null>;
  getSettingsTx(tx?: ITransactionContext): Promise<WeeklyCycleSettings | null>;
}

