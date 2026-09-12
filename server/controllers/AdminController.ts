import { Request, Response, NextFunction } from 'express';
import { AdminManageSpawnsUseCase } from '../services/AdminManageSpawnsUseCase';
import { RotateSpawnsUseCase } from '../services/RotateSpawnsUseCase';
import { GetAdminOverviewUseCase } from '../services/GetAdminOverviewUseCase';

export class AdminController {
  constructor(
    private readonly adminManageSpawnsUseCase: AdminManageSpawnsUseCase,
    private readonly rotateSpawnsUseCase: RotateSpawnsUseCase,
    private readonly getAdminOverviewUseCase: GetAdminOverviewUseCase
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

  public manualWeeklyReset = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({
        success: true,
        message: 'Manual weekly reset mutation authorized.',
      });
    } catch (err) {
      next(err);
    }
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
