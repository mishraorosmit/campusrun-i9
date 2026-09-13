import { SpawnBatch, SpawnBatchStatus } from '../domain/entities/SpawnBatch';
import { ITransactionContext } from '../infrastructure/database/types';

export interface BatchFilterOptions {
  cycleId?: string;
  status?: SpawnBatchStatus;
  limit?: number;
  offset?: number;
}

export interface IBatchRepository {
  create(batch: SpawnBatch, tx?: ITransactionContext): Promise<SpawnBatch>;
  update(batch: SpawnBatch, tx?: ITransactionContext): Promise<SpawnBatch>;
  findById(id: string, tx?: ITransactionContext): Promise<SpawnBatch | null>;
  findByBatchNumber(batchNumber: number, tx?: ITransactionContext): Promise<SpawnBatch | null>;
  findActive(cycleId?: string, tx?: ITransactionContext): Promise<SpawnBatch | null>;
  findAll(options?: BatchFilterOptions): Promise<SpawnBatch[]>;
  getNextBatchNumber(tx?: ITransactionContext): Promise<number>;
  lockCycle(cycleId: string, tx: ITransactionContext): Promise<void>;
  assignSpawns(batchId: string, spawnIds: string[], tx?: ITransactionContext): Promise<void>;
  activateBatch(batchId: string, startedAt: Date, tx: ITransactionContext): Promise<void>;
  expireBatch(batchId: string, tx?: ITransactionContext): Promise<void>;
}
