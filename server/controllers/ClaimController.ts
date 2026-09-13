import { Request, Response, NextFunction } from 'express';
import { ClaimSpawnUseCase } from '../services/ClaimSpawnUseCase';
import { ValidateClaimUseCase } from '../services/ValidateClaimUseCase';
import { GetClaimsHistoryUseCase } from '../services/GetClaimsHistoryUseCase';
import { UnauthorizedError } from '../errors';

export class ClaimController {
  constructor(
    private readonly claimSpawnUseCase: ClaimSpawnUseCase,
    private readonly getClaimsHistoryUseCase: GetClaimsHistoryUseCase,
    private readonly validateClaimUseCase?: ValidateClaimUseCase,
    private readonly defaultValidateOnly: boolean = false
  ) {}

  public submitClaim = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        throw new UnauthorizedError('Authentication required to submit or validate a claim');
      }

      // NEVER trust client user ID! Taken strictly from authenticated token context
      const playerId = req.user.id;
      const { spawnId } = req.body;
      const latitude = Number(req.body.latitude ?? req.body.lat);
      const longitude = Number(req.body.longitude ?? req.body.lng);

      // Support validateOnly pre-flight if explicitly requested or configured
      const isValidateOnly =
        this.defaultValidateOnly ||
        req.query.validateOnly === 'true' ||
        req.headers['x-validate-only'] === 'true' ||
        req.body.validateOnly === true;

      if (isValidateOnly && this.validateClaimUseCase) {
        const result = await this.validateClaimUseCase.execute({
          spawnId,
          playerId,
          playerCoordinates: { lat: latitude, lng: longitude },
        });

        res.status(200).json({
          success: true,
          data: result,
        });
        return;
      }

      // Execute authoritative claim transaction
      const result = await this.claimSpawnUseCase.execute({
        spawnId,
        playerId,
        playerCoordinates: { lat: latitude, lng: longitude },
      });

      res.status(200).json({
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
