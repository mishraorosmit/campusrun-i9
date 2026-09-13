import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IAuditService } from './IAuditService';
import { NotFoundError } from '../errors/NotFoundError';
import { transactionManager } from '../infrastructure/database/transaction';

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

    const previousEnabled = spawn.isEnabled;

    // Idempotent: If current state matches target state, no-op and return immediately
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

      return {
        id,
        enabled,
        previousEnabled,
        idempotent: true,
        batchId: spawn.batchId,
      };
    }

    // Atomically update state while preserving batch linkages and claims integrity
    await transactionManager.runInTransaction(async (tx) => {
      await this.spawnRepo.updateStatus(id, spawn.status, enabled, tx);
    });

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
          batchId: spawn.batchId,
        },
        createdAt: new Date(),
      });
    }

    return {
      id,
      enabled,
      previousEnabled,
      idempotent: false,
      batchId: spawn.batchId,
    };
  }
}
