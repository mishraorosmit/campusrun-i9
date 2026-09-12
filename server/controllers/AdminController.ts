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
}
