import { IBatchRepository } from '../repositories/IBatchRepository';
import { SpawnBatch } from '../domain/entities/SpawnBatch';
import { NotFoundError } from '../errors/NotFoundError';
import { transactionManager } from '../infrastructure/database/transaction';

export class ExpireBatchUseCase {
  constructor(private readonly batchRepo: IBatchRepository) {}

  public async execute(batchId: string): Promise<SpawnBatch> {
    return transactionManager.runInTransaction(async (tx) => {
      const batch = await this.batchRepo.findById(batchId, tx);
      if (!batch) {
        throw new NotFoundError(`Spawn batch "${batchId}" not found.`);
      }

      // Idempotent: If already expired, return immediately
      if (batch.status === 'EXPIRED') {
        return batch;
      }

      // Atomically expire batch and its member spawns
      await this.batchRepo.expireBatch(batch.id, tx);

      const updated = await this.batchRepo.findById(batch.id, tx);
      return updated!;
    });
  }
}
