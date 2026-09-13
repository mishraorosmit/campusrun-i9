import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { NotFoundError } from '../errors/NotFoundError';

export class GetSpawnByIdUseCase {
  constructor(private readonly spawnRepo: ISpawnRepository) {}

  public async execute(id: string): Promise<SpawnPoint> {
    const spawn = await this.spawnRepo.findById(id);
    if (!spawn) {
      throw new NotFoundError(`Spawn point "${id}" not found.`);
    }

    return spawn;
  }
}
