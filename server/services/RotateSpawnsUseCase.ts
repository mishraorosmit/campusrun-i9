import { IRotationRepository } from '../repositories/IRotationRepository';
import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IEventBus } from '../events/IEventBus';
import { IRealtimeService } from './IRealtimeService';
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
    private readonly options: RotateSpawnsConfig,
    private readonly realtimeService?: IRealtimeService
  ) {}

  public async execute(adminId?: string): Promise<{ rotationNumber: number; expiresAt: string }> {
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

    try {
      if (this.eventBus) {
        await this.eventBus.publish(
          new RotationTriggeredEvent({
            rotationId: newRotation.id,
            rotationNumber: newRotation.rotationNumber,
            activatedSpawnCount: this.options.concurrentActiveSpawns,
            expiresAt,
          })
        );
      }
    } catch (err) {
      console.error('[RotateSpawnsUseCase] Error publishing RotationTriggeredEvent:', err);
    }

    // Realtime broadcast to campus_global
    if (this.realtimeService) {
      this.realtimeService.broadcastSpawnBatchCreated({
        rotationNumber: newRotation.rotationNumber,
        spawns: activeSpawns.map((s) => ({
          id: s.id,
          code: s.code,
          title: s.props.title,
          points: s.points,
          tier: s.props.tier,
          claimRadiusMeters: s.claimRadiusMeters,
          coordinates: s.coordinates,
          svgCoordinates: s.props.svgCoordinates,
          zoneName: s.props.zoneName,
          zoneId: s.props.zoneId,
          expiresAt: s.props.expiresAt.toISOString(),
        })),
        expiresAt: expiresAt.toISOString(),
        timestamp: startedAt.toISOString(),
      });

      if (adminId) {
        this.realtimeService.broadcastManualRotation({
          adminId,
          triggeredBy: adminId,
          rotationNumber: newRotation.rotationNumber,
          startedAt: startedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          activeSpawnsCount: activeSpawns.length,
          timestamp: startedAt.toISOString(),
        });
      }
    }

    return {
      rotationNumber: newRotation.rotationNumber,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
