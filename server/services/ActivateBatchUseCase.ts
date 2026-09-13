import { IBatchRepository } from '../repositories/IBatchRepository';
import { SpawnBatch } from '../domain/entities/SpawnBatch';
import { NotFoundError } from '../errors/NotFoundError';
import { DomainError } from '../errors/DomainError';
import { ErrorCodes } from '../errors/ErrorCodes';
import { transactionManager } from '../infrastructure/database/transaction';

export class ActivateBatchUseCase {
  constructor(private readonly batchRepo: IBatchRepository) {}

  public async execute(batchId: string): Promise<SpawnBatch> {
    if (!batchId) {
      throw new DomainError('Batch ID is required for activation.', ErrorCodes.VALIDATION_ERROR);
    }

    return transactionManager.runInTransaction(async (tx) => {
      // 1. Fetch target batch
      const targetBatch = await this.batchRepo.findById(batchId, tx);
      if (!targetBatch) {
        throw new NotFoundError(`Spawn batch "${batchId}" not found.`);
      }

      // 2. Lock the weekly cycle to strictly serialize simultaneous activation attempts
      await this.batchRepo.lockCycle(targetBatch.cycleId, tx);

      // 3. Re-verify target batch status after acquiring lock
      const lockedTarget = await this.batchRepo.findById(batchId, tx);
      if (!lockedTarget) {
        throw new NotFoundError(`Spawn batch "${batchId}" not found.`);
      }

      // 4. Idempotency: Repeated activation of the same batch is harmless
      if (lockedTarget.status === 'ACTIVE') {
        return lockedTarget;
      }

      // 5. Illegal transition check
      if (lockedTarget.status === 'EXPIRED') {
        throw new DomainError(
          `Cannot activate an expired spawn batch ("${batchId}").`,
          ErrorCodes.DOMAIN_ERROR
        );
      }

      // 6. Find currently active batch in the cycle and expire it
      const currentActive = await this.batchRepo.findActive(lockedTarget.cycleId, tx);
      if (currentActive && currentActive.id !== lockedTarget.id) {
        await this.batchRepo.expireBatch(currentActive.id, tx);
      }

      // 7. Atomically activate new batch and its member spawns
      const activationTime = new Date();
      await this.batchRepo.activateBatch(lockedTarget.id, activationTime, tx);

      // 8. Return updated activated batch
      const updated = await this.batchRepo.findById(lockedTarget.id, tx);
      return updated!;
    });
  }
}
