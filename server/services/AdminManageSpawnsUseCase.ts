import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IRealtimeService } from './IRealtimeService';
import { IEventBus } from '../events/IEventBus';
import { IAuditService } from './IAuditService';
import { SpawnExpiredEvent } from '../domain/events';
import { NotFoundError } from '../errors';

export interface ToggleSpawnResult {
  id: string;
  enabled: boolean;
  previousEnabled: boolean;
  idempotent: boolean;
  batchId?: string | null;
}

export class AdminManageSpawnsUseCase {
  constructor(
    private readonly spawnRepo: ISpawnRepository,
    private readonly realtimeService?: IRealtimeService,
    private readonly eventBus?: IEventBus,
    private readonly auditService?: IAuditService
  ) {}

  public async toggleSpawn(
    id: string,
    enabled: boolean,
    adminId?: string | null
  ): Promise<ToggleSpawnResult> {
    const spawn = await this.spawnRepo.findById(id);
    if (!spawn) {
      if (this.auditService) {
        await this.auditService.log({
          adminId: adminId || null,
          action: 'SPAWN_TOGGLE',
          targetEntity: 'spawn_points',
          targetId: id,
          details: { result: 'FAILED', reason: 'Spawn point not found', targetEnabled: enabled },
          createdAt: new Date(),
        });
      }
      throw new NotFoundError(`Spawn point "${id}" not found.`);
    }

    const previousEnabled = (spawn as any).isEnabled ?? enabled;

    // Idempotent: If current state matches target state, return immediately
    if (previousEnabled === enabled) {
      if (this.auditService) {
        await this.auditService.log({
          adminId: adminId || null,
          action: 'SPAWN_TOGGLE',
          targetEntity: 'spawn_points',
          targetId: id,
          details: {
            result: 'SUCCESS',
            enabled,
            previousEnabled,
            idempotent: true,
            note: 'State unchanged',
          },
          createdAt: new Date(),
        });
      }
      return { id, enabled, previousEnabled, idempotent: true, batchId: (spawn as any).batchId };
    }

    await this.spawnRepo.updateStatus(id, spawn.status, enabled);

    // Publish domain event on disable
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

    // Realtime broadcast
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

    // Audit Logging
    if (this.auditService) {
      await this.auditService.log({
        adminId: adminId || null,
        action: 'SPAWN_TOGGLE',
        targetEntity: 'spawn_points',
        targetId: id,
        details: {
          result: 'SUCCESS',
          enabled,
          previousEnabled,
          idempotent: false,
          batchId: (spawn as any).batchId,
        },
        createdAt: new Date(),
      });
    }

    return {
      id,
      enabled,
      previousEnabled,
      idempotent: false,
      batchId: (spawn as any).batchId,
    };
  }
}
