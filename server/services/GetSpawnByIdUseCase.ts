import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { NotFoundError } from '../errors/NotFoundError';

export class GetSpawnByIdUseCase {
  constructor(private readonly spawnRepo: ISpawnRepository) {}

  public async execute(id: string): Promise<SpawnPoint> {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      throw new NotFoundError('Spawn ID is required');
    }

    const spawn = await this.spawnRepo.findById(id.trim());
    if (!spawn) {
      throw new NotFoundError(`Spawn point "${id}" not found.`);
    }

    return spawn;
  }
}
