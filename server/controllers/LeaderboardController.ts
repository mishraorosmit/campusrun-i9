import { Request, Response, NextFunction } from 'express';
import { GetLeaderboardUseCase } from '../services/GetLeaderboardUseCase';

export class LeaderboardController {
  constructor(private readonly getLeaderboardUseCase: GetLeaderboardUseCase) {}

  public getWeeklyLeaderboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const leaderboard = await this.getLeaderboardUseCase.execute('weekly', limit, offset);

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
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const leaderboard = await this.getLeaderboardUseCase.execute('all-time', limit, offset);

      res.json({
        success: true,
        data: leaderboard,
      });
    } catch (err) {
      next(err);
    }
  };

  public getPlayerWeeklyRank = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = (req.params.playerId || req.query.playerId) as string;
      const result = await this.getLeaderboardUseCase.getPlayerWeeklyRank(playerId);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getPlayerAllTimeRank = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = (req.params.playerId || req.query.playerId) as string;
      const result = await this.getLeaderboardUseCase.getPlayerAllTimeRank(playerId);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getPlayerRank = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = (req.params.playerId || req.query.playerId) as string;
      const result = await this.getLeaderboardUseCase.getPlayerRanks(playerId);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };
}
