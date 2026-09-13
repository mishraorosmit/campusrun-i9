import { Request, Response, NextFunction } from 'express';
import { GetPlayerProfileUseCase } from '../services/GetPlayerProfileUseCase';
import { UpdatePlayerPreferencesUseCase } from '../services/UpdatePlayerPreferencesUseCase';
import { GetPlayerStatsUseCase } from '../services/GetPlayerStatsUseCase';
import { GetClaimsHistoryUseCase } from '../services/GetClaimsHistoryUseCase';
import { UnauthorizedError, ValidationError } from '../errors';

export class PlayerController {
  constructor(
    private readonly getPlayerProfileUseCase: GetPlayerProfileUseCase,
    private readonly updatePlayerPreferencesUseCase?: UpdatePlayerPreferencesUseCase,
    private readonly getPlayerStatsUseCase?: GetPlayerStatsUseCase,
    private readonly getClaimsHistoryUseCase?: GetClaimsHistoryUseCase
  ) {}

  /**
   * Resolves the authenticated user's own profile strictly from request context (req.user.id).
   * Client-supplied query/body IDs are completely ignored.
   */
  public getMyProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = req.user?.id;
      if (!playerId) {
        throw new UnauthorizedError('Authentication required');
      }

      const profile = await this.getPlayerProfileUseCase.execute(playerId);

      res.json({
        success: true,
        data: profile,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Resolves the authenticated user's statistics and rankings.
   */
  public getMyStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = req.user?.id;
      if (!playerId) {
        throw new UnauthorizedError('Authentication required');
      }

      if (!this.getPlayerStatsUseCase) {
        throw new Error('GetPlayerStatsUseCase not configured');
      }

      const stats = await this.getPlayerStatsUseCase.execute(playerId);

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Resolves only the authenticated user's claims ordered by newest first.
   */
  public getMyClaims = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = req.user?.id;
      if (!playerId) {
        throw new UnauthorizedError('Authentication required');
      }

      if (!this.getClaimsHistoryUseCase) {
        throw new Error('GetClaimsHistoryUseCase not configured');
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const claims = await this.getClaimsHistoryUseCase.execute(playerId, limit);

      res.status(200).json({
        success: true,
        data: claims,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Updates only the authenticated user's shallow preferences.
   */
  public updatePreferences = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = req.user?.id;
      if (!playerId) {
        throw new UnauthorizedError('Authentication required');
      }

      if (!this.updatePlayerPreferencesUseCase) {
        throw new Error('UpdatePlayerPreferencesUseCase not configured');
      }

      const updated = await this.updatePlayerPreferencesUseCase.execute(playerId, req.body);

      res.status(200).json({
        success: true,
        data: updated,
        preferences: updated,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Public / player lookup by path param :id.
   */
  public getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const playerId = req.params.id;
      if (!playerId) {
        throw new ValidationError('Player identifier parameter is required');
      }

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

