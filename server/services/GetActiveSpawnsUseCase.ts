import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { BoundingBox } from '../domain/types';
import { SpawnPoint } from '../domain/entities/SpawnPoint';

export class GetActiveSpawnsUseCase {
  constructor(private readonly spawnRepo: ISpawnRepository) {}

  public async execute(bounds?: BoundingBox): Promise<SpawnPoint[]> {
    const spawns = bounds
      ? await this.spawnRepo.findActive({ bounds })
      : await this.spawnRepo.findActive();

    return spawns.filter((s) => s.isActive());
  }
}
