import { IRotationRepository } from '../repositories/IRotationRepository';
import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IEventBus } from '../events/IEventBus';
import { Rotation } from '../domain/entities/Rotation';
import { RotationTriggeredEvent } from '../domain/events';

export interface RotateSpawnsConfig {
  rotationIntervalMinutes: number;
  concurrentActiveSpawns: number;
}

export class RotateSpawnsUseCase {
  constructor(
    private readonly rotationRepo: IRotationRepository,
    private readonly spawnRepo: ISpawnRepository,
    private readonly eventBus: IEventBus,
    private readonly options: RotateSpawnsConfig
  ) {}

  public async execute(): Promise<{ rotationNumber: number; expiresAt: string }> {
    const current = await this.rotationRepo.getCurrent();
    const nextNumber = current ? current.rotationNumber + 1 : 1;

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + this.options.rotationIntervalMinutes * 60 * 1000);

    const activeSpawns = await this.spawnRepo.findActive();

    const newRotation = new Rotation({
      id: `rot_${Date.now()}`,
      rotationNumber: nextNumber,
      startedAt,
      expiresAt,
      totalSpawns: activeSpawns.length,
      activeSpawns: this.options.concurrentActiveSpawns,
      nextRotationInSeconds: this.options.rotationIntervalMinutes * 60,
    });

    await this.rotationRepo.save(newRotation);

    await this.eventBus.publish(
      new RotationTriggeredEvent({
        rotationId: newRotation.id,
        rotationNumber: newRotation.rotationNumber,
        activatedSpawnCount: this.options.concurrentActiveSpawns,
        expiresAt,
      })
    );

    return {
      rotationNumber: newRotation.rotationNumber,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
