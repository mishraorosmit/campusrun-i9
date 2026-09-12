import { Request, Response, NextFunction } from 'express';
import { GetZonesUseCase, GetZoneByIdUseCase } from '../services/GetZonesUseCase';

export class ZoneController {
  constructor(
    private readonly getZonesUseCase: GetZonesUseCase,
    private readonly getZoneByIdUseCase: GetZoneByIdUseCase
  ) {}

  public getAllZones = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const zones = await this.getZonesUseCase.execute();
      res.json({
        success: true,
        data: zones,
      });
    } catch (err) {
      next(err);
    }
  };

  public getZoneById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const zone = await this.getZoneByIdUseCase.execute(id);

      res.json({
        success: true,
        data: zone,
      });
    } catch (err) {
      next(err);
    }
  };
}
