import { IBatchRepository, BatchFilterOptions } from '../../../repositories/IBatchRepository';
import { SpawnBatch } from '../../../domain/entities/SpawnBatch';
import { NotFoundError } from '../../../errors/NotFoundError';
import { ITransactionContext } from '../../database/types';

export class InMemoryBatchRepository implements IBatchRepository {
  private batches: Map<string, SpawnBatch> = new Map();
  private batchSpawns: Map<string, string[]> = new Map();

  constructor(initialBatches: SpawnBatch[] = []) {
    for (const batch of initialBatches) {
      this.batches.set(batch.id, batch);
      this.batchSpawns.set(batch.id, [...batch.spawnIds]);
    }
  }

  async create(batch: SpawnBatch): Promise<SpawnBatch> {
    this.batches.set(batch.id, batch);
    this.batchSpawns.set(batch.id, [...batch.spawnIds]);
    return batch;
  }

  async update(batch: SpawnBatch): Promise<SpawnBatch> {
    if (!this.batches.has(batch.id)) {
      throw new NotFoundError(`Spawn batch "${batch.id}" not found.`);
    }
    this.batches.set(batch.id, batch);
    return batch;
  }

  async findById(id: string): Promise<SpawnBatch | null> {
    const batch = this.batches.get(id);
    if (!batch) return null;
    const spawnIds = this.batchSpawns.get(id) || [];
    return new SpawnBatch({
      ...batch.props,
      spawnIds,
    });
  }

  async findByBatchNumber(batchNumber: number): Promise<SpawnBatch | null> {
    for (const batch of this.batches.values()) {
      if (batch.batchNumber === batchNumber) {
        const spawnIds = this.batchSpawns.get(batch.id) || [];
        return new SpawnBatch({
          ...batch.props,
          spawnIds,
        });
      }
    }
    return null;
  }

  async findActive(cycleId?: string): Promise<SpawnBatch | null> {
    for (const batch of this.batches.values()) {
      if ((!cycleId || batch.cycleId === cycleId) && batch.isActive()) {
        const spawnIds = this.batchSpawns.get(batch.id) || [];
        return new SpawnBatch({
          ...batch.props,
          spawnIds,
        });
      }
    }
    return null;
  }

  async findAll(options: BatchFilterOptions = {}): Promise<SpawnBatch[]> {
    let list = Array.from(this.batches.values());

    if (options.cycleId) {
      list = list.filter((b) => b.cycleId === options.cycleId);
    }
    if (options.status) {
      list = list.filter((b) => b.status === options.status);
    }

    list = list.sort((a, b) => b.batchNumber - a.batchNumber);
    const offset = options.offset || 0;
    const limit = options.limit || 50;

    return list.slice(offset, offset + limit).map((batch) => {
      const spawnIds = this.batchSpawns.get(batch.id) || [];
      return new SpawnBatch({
        ...batch.props,
        spawnIds,
      });
    });
  }

  async getNextBatchNumber(): Promise<number> {
    let max = 0;
    for (const batch of this.batches.values()) {
      if (batch.batchNumber > max) max = batch.batchNumber;
    }
    return max + 1;
  }

  async lockCycle(_cycleId: string, _tx: ITransactionContext): Promise<void> {
    // In-memory no-op
  }

  async assignSpawns(batchId: string, spawnIds: string[]): Promise<void> {
    this.batchSpawns.set(batchId, [...spawnIds]);
  }

  async activateBatch(batchId: string, startedAt: Date): Promise<void> {
    const batch = this.batches.get(batchId);
    if (batch) {
      const activated = batch.activate(startedAt);
      this.batches.set(batchId, activated);
    }
  }

  async expireBatch(batchId: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (batch) {
      const expired = batch.expire();
      this.batches.set(batchId, expired);
    }
  }
}
