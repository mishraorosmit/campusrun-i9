import { Request, Response, NextFunction } from 'express';
import { ClaimSpawnUseCase } from '../services/ClaimSpawnUseCase';
import { GetClaimsHistoryUseCase } from '../services/GetClaimsHistoryUseCase';
import { UnauthorizedError, ValidationError } from '../errors';

export class ClaimController {
  constructor(
    private readonly claimSpawnUseCase: ClaimSpawnUseCase,
    private readonly getClaimsHistoryUseCase: GetClaimsHistoryUseCase
  ) {}

  public submitClaim = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = req.user?.id || req.body?.playerId;

      if (!playerId) {
        throw new UnauthorizedError('Authentication required to submit claims');
      }

      const spawnId = req.body?.spawnId || req.body?.spawn_id;
      if (!spawnId || typeof spawnId !== 'string' || spawnId.trim() === '') {
        throw new ValidationError('spawnId is required and must be a non-empty string');
      }

      let playerCoordinates = undefined;
      if (req.body?.lat !== undefined && req.body?.lng !== undefined) {
        const lat = typeof req.body.lat === 'number' ? req.body.lat : parseFloat(req.body.lat);
        const lng = typeof req.body.lng === 'number' ? req.body.lng : parseFloat(req.body.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          playerCoordinates = { lat, lng };
        }
      }

      const result = await this.claimSpawnUseCase.execute({
        spawnId: spawnId.trim(),
        playerId,
        playerCoordinates: playerCoordinates as any,
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
