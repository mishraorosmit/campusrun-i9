import { WeeklyCycleService, NextResetDTO } from './WeeklyCycleService';
import { IWeeklyCycleRepository } from '../repositories/IWeeklyCycleRepository';

export class GetNextWeeklyResetUseCase {
  private readonly weeklyCycleService: WeeklyCycleService;

  constructor(weeklyCycleRepoOrService: IWeeklyCycleRepository | WeeklyCycleService) {
    if ('getNextResetTimestamp' in weeklyCycleRepoOrService) {
      this.weeklyCycleService = weeklyCycleRepoOrService;
    } else {
      this.weeklyCycleService = new WeeklyCycleService(weeklyCycleRepoOrService);
    }
  }

  /**
   * Executes the use case to fetch the next weekly reset timestamp.
   * Initializes active cycle safely if missing without resetting player points.
   */
  public async execute(currentDate?: Date): Promise<NextResetDTO> {
    return this.weeklyCycleService.getNextResetTimestamp(currentDate);
  }
}
