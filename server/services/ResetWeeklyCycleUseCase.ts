import { WeeklyCycleService, ResetWeeklyCycleInputDTO, ResetWeeklyCycleResultDTO } from './WeeklyCycleService';
import { IWeeklyCycleRepository } from '../repositories/IWeeklyCycleRepository';
import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';
import { ITransactionManager } from '../repositories/ITransactionManager';

export class ResetWeeklyCycleUseCase {
  private readonly weeklyCycleService: WeeklyCycleService;

  constructor(
    weeklyCycleRepoOrService: IWeeklyCycleRepository | WeeklyCycleService,
    leaderboardRepo?: ILeaderboardRepository,
    txManager?: ITransactionManager
  ) {
    if ('resetWeeklyCycle' in weeklyCycleRepoOrService) {
      this.weeklyCycleService = weeklyCycleRepoOrService;
    } else {
      this.weeklyCycleService = new WeeklyCycleService(weeklyCycleRepoOrService, leaderboardRepo, txManager);
    }
  }

  /**
   * Resets weekly scores safely inside a single PostgreSQL transaction while strictly
   * preserving all-time points and claim history. Uses resetKey for idempotency.
   */
  public async execute(input: ResetWeeklyCycleInputDTO): Promise<ResetWeeklyCycleResultDTO> {
    return this.weeklyCycleService.resetWeeklyCycle(input);
  }

  /**
   * Alias method for direct resetWeeklyCycle calls.
   */
  public async resetWeeklyCycle(input: ResetWeeklyCycleInputDTO): Promise<ResetWeeklyCycleResultDTO> {
    return this.execute(input);
  }
}
