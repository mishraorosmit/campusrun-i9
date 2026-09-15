import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IWeeklyCycleRepository } from '../repositories/IWeeklyCycleRepository';
import { GameStateDTO } from './dtos';

export class GetGameStateUseCase {
  constructor(
    private readonly spawnRepo: ISpawnRepository,
    private readonly weeklyCycleRepo?: IWeeklyCycleRepository
  ) {}

  public async execute(): Promise<GameStateDTO> {
    const activeSpawns = await this.spawnRepo.findActive();
    const activeSpawnsCount = activeSpawns.length;

    let currentCycle = null;
    let nextResetAt = null;

    if (this.weeklyCycleRepo) {
      const activeCycle = await this.weeklyCycleRepo.getActiveCycle();
      if (activeCycle) {
        currentCycle = {
          id: activeCycle.id,
          status: activeCycle.status,
          startsAt: activeCycle.startsAt.toISOString(),
          endsAt: activeCycle.endsAt.toISOString(),
        };
        nextResetAt = activeCycle.endsAt.toISOString();
      }
    }

    return {
      status: currentCycle ? currentCycle.status : 'active',
      serverTimestamp: new Date().toISOString(),
      activeSpawnsCount,
      currentCycle,
      nextResetAt,
    };
  }
}
