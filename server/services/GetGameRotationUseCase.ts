import { IRotationRepository } from '../repositories/IRotationRepository';
import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { GameRotationDTO } from './dtos';

export class GetGameRotationUseCase {
  constructor(
    private readonly rotationRepo: IRotationRepository,
    private readonly spawnRepo: ISpawnRepository
  ) {}

  public async execute(): Promise<GameRotationDTO> {
    const currentRotation = await this.rotationRepo.getCurrent();
    const activeSpawns = await this.spawnRepo.findActive();
    const now = new Date();

    if (currentRotation) {
      const nextRotationInSeconds = Math.max(
        0,
        Math.floor((currentRotation.props.expiresAt.getTime() - now.getTime()) / 1000)
      );

      return {
        id: currentRotation.id,
        rotationNumber: currentRotation.rotationNumber,
        startedAt: currentRotation.props.startedAt.toISOString(),
        expiresAt: currentRotation.props.expiresAt.toISOString(),
        totalSpawns: currentRotation.props.totalSpawns || activeSpawns.length,
        activeSpawns: currentRotation.props.activeSpawns || activeSpawns.length,
        nextRotationInSeconds,
        isExpired: currentRotation.isExpired,
      };
    }

    // Fallback: derive safe rotation state from current active spawns
    let expiresAt = new Date(now.getTime() + 45 * 60 * 1000);
    if (activeSpawns.length > 0 && activeSpawns[0].props.expiresAt) {
      expiresAt = activeSpawns[0].props.expiresAt;
    }
    const startedAt = new Date(expiresAt.getTime() - 45 * 60 * 1000);
    const nextRotationInSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

    return {
      id: 'rot_active',
      rotationNumber: 1,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      totalSpawns: activeSpawns.length,
      activeSpawns: activeSpawns.length,
      nextRotationInSeconds,
      isExpired: now > expiresAt,
    };
  }
}
