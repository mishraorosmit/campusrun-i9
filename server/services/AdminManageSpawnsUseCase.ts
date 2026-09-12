import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { NotFoundError } from '../errors';

export class AdminManageSpawnsUseCase {
  constructor(private readonly spawnRepo: ISpawnRepository) {}

  public async toggleSpawn(id: string, enabled: boolean): Promise<{ id: string; enabled: boolean }> {
    const spawn = await this.spawnRepo.findById(id);
    if (!spawn) {
      throw new NotFoundError(`Spawn point "${id}" not found`);
    }

    await this.spawnRepo.updateStatus(id, spawn.status, enabled);
    return { id, enabled };
  }
}
