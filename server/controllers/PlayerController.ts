import { Request, Response, NextFunction } from 'express';
import { GetPlayerProfileUseCase } from '../services/GetPlayerProfileUseCase';

export class PlayerController {
  constructor(private readonly getPlayerProfileUseCase: GetPlayerProfileUseCase) {}

  public getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = (req.query.playerId as string) || (req.params.id as string);
      const profile = await this.getPlayerProfileUseCase.execute(playerId);

      res.json({
        success: true,
        data: profile,
      });
    } catch (err) {
      next(err);
    }
  };
}
