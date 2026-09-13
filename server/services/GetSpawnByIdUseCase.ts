import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { SpawnSummaryDTO } from './dtos';
import { NotFoundError } from '../errors';

export class GetSpawnByIdUseCase {
  constructor(private readonly spawnRepo: ISpawnRepository) {}

  public async execute(id: string): Promise<SpawnSummaryDTO> {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      throw new NotFoundError('Spawn ID is required');
    }

    const spawn = await this.spawnRepo.findById(id.trim());
    if (!spawn) {
      throw new NotFoundError(`Spawn point "${id}" not found`);
    }

    return {
      id: spawn.id,
      code: spawn.code,
      title: spawn.props.title,
      description: spawn.props.description || undefined,
      clue: spawn.props.clue || undefined,
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
