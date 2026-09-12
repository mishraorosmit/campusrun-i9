import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { SpawnSummaryDTO } from './dtos';
import { NotFoundError } from '../errors';

export class GetSpawnByIdUseCase {
  constructor(private readonly spawnRepo: ISpawnRepository) {}

  public async execute(id: string): Promise<SpawnSummaryDTO> {
    const spawn = await this.spawnRepo.findById(id);
    if (!spawn) {
      throw new NotFoundError(`Spawn point "${id}" not found`);
    }

    return {
      id: spawn.id,
      code: spawn.code,
      title: spawn.props.title,
      tier: spawn.props.tier,
      status: spawn.status,
      points: spawn.points,
      claimRadiusMeters: spawn.claimRadiusMeters,
      coordinates: spawn.coordinates,
      svgCoordinates: spawn.props.svgCoordinates,
      zoneName: spawn.props.zoneName,
      expiresAt: spawn.props.expiresAt.toISOString(),
    };
  }
}
