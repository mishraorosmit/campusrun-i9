import { ISpawnRepository, SpawnFilterOptions } from '../repositories/ISpawnRepository';
import { SpawnPoint } from '../domain/entities/SpawnPoint';

export class ListSpawnsUseCase {
  constructor(private readonly spawnRepo: ISpawnRepository) {}

  public async execute(options?: SpawnFilterOptions): Promise<SpawnPoint[]> {
    return this.spawnRepo.findAll(options);
  }
}
