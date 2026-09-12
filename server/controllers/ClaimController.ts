import { Request, Response, NextFunction } from 'express';
import { ClaimSpawnUseCase } from '../services/ClaimSpawnUseCase';
import { GetClaimsHistoryUseCase } from '../services/GetClaimsHistoryUseCase';

export class ClaimController {
  constructor(
    private readonly claimSpawnUseCase: ClaimSpawnUseCase,
    private readonly getClaimsHistoryUseCase: GetClaimsHistoryUseCase
  ) {}

  public submitClaim = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { spawnId, playerId, lat, lng } = req.body;

      const result = await this.claimSpawnUseCase.execute({
        spawnId,
        playerId,
        playerCoordinates: { lat, lng },
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getPlayerClaimsHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { playerId } = req.query;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const claims = await this.getClaimsHistoryUseCase.execute(
        playerId ? (playerId as string) : undefined,
        limit
      );

      res.json({
        success: true,
        data: claims,
      });
    } catch (err) {
      next(err);
    }
  };
}
