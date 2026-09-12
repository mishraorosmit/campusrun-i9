import { Request, Response, NextFunction } from 'express';
import { GetPlayerProfileUseCase } from '../services/GetPlayerProfileUseCase';
import { UnauthorizedError, ValidationError } from '../errors';

export class PlayerController {
  constructor(private readonly getPlayerProfileUseCase: GetPlayerProfileUseCase) {}

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

