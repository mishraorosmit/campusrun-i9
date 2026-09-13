import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IRealtimeService } from './IRealtimeService';
import { IEventBus } from '../events/IEventBus';
import { SpawnExpiredEvent } from '../domain/events';
import { NotFoundError } from '../errors';

export class AdminManageSpawnsUseCase {
  constructor(
    private readonly spawnRepo: ISpawnRepository,
    private readonly realtimeService?: IRealtimeService,
    private readonly eventBus?: IEventBus
  ) {}

  public async toggleSpawn(id: string, enabled: boolean): Promise<{ id: string; enabled: boolean }> {
    const spawn = await this.spawnRepo.findById(id);
    if (!spawn) {
      throw new NotFoundError(`Spawn point "${id}" not found`);
    }

    await this.spawnRepo.updateStatus(id, spawn.status, enabled);

    if (!enabled && this.eventBus) {
      try {
        await this.eventBus.publish(
          new SpawnExpiredEvent({
            spawnIds: [id],
            spawnId: id,
            spawnCode: spawn.code,
            zoneId: spawn.props.zoneId,
            reason: 'DISABLED',
            expiredAt: new Date(),
          })
        );
      } catch (err) {
        console.error('[AdminManageSpawnsUseCase] Error publishing SpawnExpiredEvent:', err);
      }
    }

    if (this.realtimeService) {
      if (!enabled) {
        this.realtimeService.broadcastSpawnsExpired({
          spawnIds: [id],
          spawnId: id,
          spawnCode: spawn.code,
          reason: 'DISABLED',
          timestamp: new Date().toISOString(),
        });
      } else {
        this.realtimeService.broadcastSpawnBatchCreated({
          spawns: [
            {
              id: spawn.id,
              code: spawn.code,
              title: spawn.props.title,
              points: spawn.points,
              tier: spawn.props.tier,
              claimRadiusMeters: spawn.claimRadiusMeters,
              coordinates: spawn.coordinates,
              svgCoordinates: spawn.props.svgCoordinates,
              zoneName: spawn.props.zoneName,
              zoneId: spawn.props.zoneId,
              expiresAt: spawn.props.expiresAt.toISOString(),
            },
          ],
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { id, enabled };
  }
}

