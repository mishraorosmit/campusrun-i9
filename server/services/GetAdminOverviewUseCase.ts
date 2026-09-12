import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IClaimRepository } from '../repositories/IClaimRepository';
import { AdminOverviewDTO } from './dtos';

export class GetAdminOverviewUseCase {
  constructor(
    private readonly spawnRepo: ISpawnRepository,
    private readonly claimRepo: IClaimRepository
  ) {}

  public async execute(): Promise<AdminOverviewDTO> {
    const activeSpawns = await this.spawnRepo.findActive();
    const recentClaims = await this.claimRepo.findRecent(10);

    return {
      activeSpawnsCount: activeSpawns.length,
      totalRecentClaims: recentClaims.length,
      serverTimestamp: new Date().toISOString(),
    };
  }
}
