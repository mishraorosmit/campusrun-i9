import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { BoundingBox } from '../domain/types';
import { SpawnSummaryDTO } from './dtos';

export class GetActiveSpawnsUseCase {
  constructor(private readonly spawnRepo: ISpawnRepository) {}

  public async execute(bounds?: BoundingBox): Promise<SpawnSummaryDTO[]> {
    const spawns = bounds
      ? await this.spawnRepo.findWithinBounds(bounds)
      : await this.spawnRepo.findActive();

    return spawns
      .filter((s) => s.isActive())
      .map((s) => ({
        id: s.id,
        code: s.code,
        title: s.props.title,
        tier: s.props.tier,
        status: s.status,
        points: s.points,
        claimRadiusMeters: s.claimRadiusMeters,
        coordinates: s.coordinates,
        svgCoordinates: s.props.svgCoordinates,
        zoneName: s.props.zoneName,
        expiresAt: s.props.expiresAt.toISOString(),
      }));
  }
}
