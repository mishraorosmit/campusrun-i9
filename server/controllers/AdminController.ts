import { Request, Response, NextFunction } from 'express';
import { AdminManageSpawnsUseCase } from '../services/AdminManageSpawnsUseCase';
import { RotateSpawnsUseCase } from '../services/RotateSpawnsUseCase';
import { GetAdminOverviewUseCase } from '../services/GetAdminOverviewUseCase';
import { ResetWeeklyLeaderboardUseCase } from '../services/ResetWeeklyLeaderboardUseCase';
import { ResetWeeklyCycleUseCase } from '../services/ResetWeeklyCycleUseCase';
import { IWeeklyCycleRepository } from '../repositories/IWeeklyCycleRepository';

export class AdminController {
  constructor(
    private readonly adminManageSpawnsUseCase: AdminManageSpawnsUseCase,
    private readonly rotateSpawnsUseCase: RotateSpawnsUseCase,
    private readonly getAdminOverviewUseCase: GetAdminOverviewUseCase,
    private readonly resetWeeklyLeaderboardUseCase?: ResetWeeklyLeaderboardUseCase,
    private readonly resetWeeklyCycleUseCase?: ResetWeeklyCycleUseCase,
    private readonly weeklyCycleRepo?: IWeeklyCycleRepository
  ) {}

  public toggleSpawn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;

      const result = await this.adminManageSpawnsUseCase.toggleSpawn(id, enabled);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public triggerRotation = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.rotateSpawnsUseCase.execute();

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getOverview = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const overview = await this.getAdminOverviewUseCase.execute();

      res.json({
        success: true,
        data: overview,
      });
    } catch (err) {
      next(err);
    }
  };

  public resetWeeklyLeaderboard = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.resetWeeklyLeaderboardUseCase) {
        throw new Error('ResetWeeklyLeaderboardUseCase not configured');
      }

      const result = await this.resetWeeklyLeaderboardUseCase.execute();

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/admin/weekly-cycle/reset
   * Triggers manual weekly reset with deterministic key: `manual:<active_cycle_id>`
   */
  public resetWeeklyCycle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.resetWeeklyCycleUseCase) {
        throw new Error('ResetWeeklyCycleUseCase not configured');
      }

      let activeCycleId = 'initial';
      if (this.weeklyCycleRepo) {
        const activeCycle = await this.weeklyCycleRepo.getActiveCycle();
        if (activeCycle) {
          activeCycleId = activeCycle.id;
        }
      }

      const resetKey = (req.body?.resetKey as string) || `manual:${activeCycleId}`;
      const triggeredByProfileId = req.user?.id || (req.body?.triggeredByProfileId as string) || null;

      const result = await this.resetWeeklyCycleUseCase.execute({
        resetKey,
        resetType: 'manual',
        triggeredByProfileId,
      });

      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Planned Admin Routes (Guarded by requireAdmin)
   */
  public createSpawn = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.status(201).json({
        success: true,
        message: 'Spawn creation endpoint authorized.',
      });
    } catch (err) {
      next(err);
    }
  };

  public editSpawn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      res.json({
        success: true,
        message: `Spawn "${id}" editing authorized.`,
      });
    } catch (err) {
      next(err);
    }
  };

  public getRotationConfig = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({
        success: true,
        message: 'Rotation configuration read authorized.',
      });
    } catch (err) {
      next(err);
    }
  };

  public updateRotationConfig = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({
        success: true,
        message: 'Rotation configuration mutation authorized.',
      });
    } catch (err) {
      next(err);
    }
  };

  public getWeeklyResetConfig = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({
        success: true,
        message: 'Weekly reset configuration read authorized.',
      });
    } catch (err) {
      next(err);
    }
  };

  public updateWeeklyResetConfig = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({
        success: true,
        message: 'Weekly reset configuration mutation authorized.',
      });
    } catch (err) {
      next(err);
    }
  };

  public manualWeeklyReset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    return this.resetWeeklyCycle(req, res, next);
  };

  public getGameSettings = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({
        success: true,
        message: 'Game settings read authorized.',
      });
    } catch (err) {
      next(err);
    }
  };

  public updateGameSettings = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({
        success: true,
        message: 'Game settings mutation authorized.',
      });
    } catch (err) {
      next(err);
    }
  };
}
