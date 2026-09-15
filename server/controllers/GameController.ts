import { Request, Response, NextFunction } from 'express';
import { GetGameStateUseCase } from '../services/GetGameStateUseCase';
import { GetGameRotationUseCase } from '../services/GetGameRotationUseCase';

export class GameController {
  constructor(
    private readonly getGameStateUseCase: GetGameStateUseCase,
    private readonly getGameRotationUseCase: GetGameRotationUseCase
  ) {}

  /**
   * Retrieves the current game state.
   * GET /api/v1/game/state
   */
  public getGameState = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const state = await this.getGameStateUseCase.execute();
      res.status(200).json({
        success: true,
        data: state,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Retrieves the current rotation state.
   * GET /api/v1/game/rotation
   */
  public getGameRotation = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rotation = await this.getGameRotationUseCase.execute();
      res.status(200).json({
        success: true,
        data: rotation,
      });
    } catch (err) {
      next(err);
    }
  };
}
