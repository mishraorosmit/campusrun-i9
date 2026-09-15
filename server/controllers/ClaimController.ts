import { Request, Response, NextFunction } from 'express';
import { ClaimSpawnUseCase } from '../services/ClaimSpawnUseCase';
import { ValidateClaimUseCase } from '../services/ValidateClaimUseCase';
import { GetClaimsHistoryUseCase } from '../services/GetClaimsHistoryUseCase';
import { UnauthorizedError, ValidationError } from '../errors';

export class ClaimController {
  constructor(
    private readonly claimSpawnUseCase: ClaimSpawnUseCase,
    private readonly getClaimsHistoryUseCase: GetClaimsHistoryUseCase,
    private readonly validateClaimUseCase?: ValidateClaimUseCase,
    private readonly defaultValidateOnly: boolean = false
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

      const latitude = req.body.latitude !== undefined ? Number(req.body.latitude) : undefined;
      const longitude = req.body.longitude !== undefined ? Number(req.body.longitude) : undefined;
      const lat = req.body.lat !== undefined ? Number(req.body.lat) : undefined;
      const lng = req.body.lng !== undefined ? Number(req.body.lng) : undefined;

      let playerCoordinates: { lat: number; lng: number } | undefined;
      const finalLat = latitude ?? lat;
      const finalLng = longitude ?? lng;
      if (finalLat !== undefined && finalLng !== undefined && !isNaN(finalLat) && !isNaN(finalLng)) {
        playerCoordinates = { lat: finalLat, lng: finalLng };
      }

      // Support validateOnly pre-flight if explicitly requested or configured
      const isValidateOnly =
        this.defaultValidateOnly ||
        req.query?.validateOnly === 'true' ||
        req.headers?.['x-validate-only'] === 'true' ||
        req.body?.validateOnly === true;


      if (isValidateOnly && this.validateClaimUseCase) {
        const result = await this.validateClaimUseCase.execute({
          spawnId,
          playerId,
          playerCoordinates: playerCoordinates || { lat: 0, lng: 0 },
        });

        res.status(200).json({
          success: true,
          data: result,
        });
        return;
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
      const playerId = req.user?.id || (req.query.playerId as string);
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
