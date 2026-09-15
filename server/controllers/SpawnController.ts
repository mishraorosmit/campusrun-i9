import { Request, Response, NextFunction } from 'express';
import { GetActiveSpawnsUseCase } from '../services/GetActiveSpawnsUseCase';
import { GetSpawnByIdUseCase } from '../services/GetSpawnByIdUseCase';
import { ListSpawnsUseCase } from '../services/ListSpawnsUseCase';
import { SpawnPoint } from '../domain/entities/SpawnPoint';

/** Strips internal/admin-only fields before sending to unauthenticated clients */
function toPublicSpawnDTO(s: SpawnPoint) {
  return {
    id: s.id,
    code: s.code,
    title: s.props.title,
    description: s.props.description || undefined,
    clue: s.props.clue || undefined,
    tier: s.props.tier,
    status: s.status,
    points: s.points,
    claimRadiusMeters: s.claimRadiusMeters,
    coordinates: s.coordinates,
    svgCoordinates: s.props.svgCoordinates,
    zoneName: s.props.zoneName,
    expiresAt: s.props.expiresAt.toISOString(),
  };
}

export class SpawnController {
  constructor(
    private readonly getActiveSpawnsUseCase: GetActiveSpawnsUseCase,
    private readonly getSpawnByIdUseCase: GetSpawnByIdUseCase,
    private readonly listSpawnsUseCase?: ListSpawnsUseCase
  ) {}

  public listSpawns = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.listSpawnsUseCase) {
        return this.getActiveSpawns(req, res, next);
      }

      const { status, enabled, batchId, tier, limit, offset } = req.query;

      let parsedEnabled: boolean | undefined = undefined;
      if (enabled !== undefined) {
        parsedEnabled = String(enabled).toLowerCase() === 'true';
      }

      const spawns = await this.listSpawnsUseCase.execute({
        status: status as string | undefined,
        enabled: parsedEnabled,
        batchId: batchId as string | undefined,
        tier: tier as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      });

      res.json({
        success: true,
        data: spawns.map((s) => s.toJSON()),
      });
    } catch (err) {
      next(err);
    }
  };

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
        data: spawns.map(toPublicSpawnDTO),
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
        data: toPublicSpawnDTO(spawn),
      });
    } catch (err) {
      next(err);
    }
  };
}
