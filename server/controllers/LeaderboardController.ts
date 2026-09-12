import { Request, Response, NextFunction } from 'express';
import { GetLeaderboardUseCase } from '../services/GetLeaderboardUseCase';

export class LeaderboardController {
  constructor(private readonly getLeaderboardUseCase: GetLeaderboardUseCase) {}

  public getWeeklyLeaderboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const leaderboard = await this.getLeaderboardUseCase.execute('weekly', limit);

      res.json({
        success: true,
        data: leaderboard,
      });
    } catch (err) {
      next(err);
    }
  };

  public getAllTimeLeaderboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const leaderboard = await this.getLeaderboardUseCase.execute('all-time', limit);

      res.json({
        success: true,
        data: leaderboard,
      });
    } catch (err) {
      next(err);
    }
  };
}
