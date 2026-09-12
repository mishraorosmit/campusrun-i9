import { Request, Response, NextFunction } from 'express';
import { GetNextWeeklyResetUseCase } from '../services/GetNextWeeklyResetUseCase';

export class WeeklyCycleController {
  constructor(private readonly getNextWeeklyResetUseCase: GetNextWeeklyResetUseCase) {}

  public getNextReset = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.getNextWeeklyResetUseCase.execute();

      res.status(200).json({
        success: true,
        data: result,
        nextResetAt: result.nextResetAt,
      });
    } catch (err) {
      next(err);
    }
  };
}
