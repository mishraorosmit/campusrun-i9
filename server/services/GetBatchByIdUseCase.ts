import { IBatchRepository } from '../repositories/IBatchRepository';
import { SpawnBatch } from '../domain/entities/SpawnBatch';
import { NotFoundError } from '../errors/NotFoundError';

export class GetBatchByIdUseCase {
  constructor(private readonly batchRepo: IBatchRepository) {}

  public async execute(id: string): Promise<SpawnBatch> {
    const batch = await this.batchRepo.findById(id);
    if (!batch) {
      throw new NotFoundError(`Spawn batch "${id}" not found.`);
    }
    return batch;
  }
}
