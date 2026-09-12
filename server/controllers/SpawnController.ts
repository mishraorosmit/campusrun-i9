import { Request, Response, NextFunction } from 'express';
import { GetActiveSpawnsUseCase } from '../services/GetActiveSpawnsUseCase';
import { GetSpawnByIdUseCase } from '../services/GetSpawnByIdUseCase';

export class SpawnController {
  constructor(
    private readonly getActiveSpawnsUseCase: GetActiveSpawnsUseCase,
    private readonly getSpawnByIdUseCase: GetSpawnByIdUseCase
  ) {}

  public getActiveSpawns = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { north, south, east, west } = req.query;

      let bounds = undefined;
      if (north && south && east && west) {
        bounds = {
          northWest: { lat: parseFloat(north as string), lng: parseFloat(west as string) },
          southEast: { lat: parseFloat(south as string), lng: parseFloat(east as string) },
        };
      }

      const spawns = await this.getActiveSpawnsUseCase.execute(bounds);
      res.json({
        success: true,
        data: spawns,
      });
    } catch (err) {
      next(err);
    }
  };

  public getSpawnById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const spawn = await this.getSpawnByIdUseCase.execute(id);

      res.json({
        success: true,
        data: spawn,
      });
    } catch (err) {
      next(err);
    }
  };
}
