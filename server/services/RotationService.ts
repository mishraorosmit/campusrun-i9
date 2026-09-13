import crypto from 'crypto';
import { IBatchRepository } from '../repositories/IBatchRepository';
import { GenerateBatchUseCase } from './GenerateBatchUseCase';
import { GameSettingsService } from './GameSettingsService';
import { IRotationService, RotationOptions, RotationResult } from './IRotationService';
import { SpawnBatch } from '../domain/entities/SpawnBatch';
import { DatabasePool, dbPool } from '../infrastructure/database/pool';
import { transactionManager } from '../infrastructure/database/transaction';
import { DomainError } from '../errors/DomainError';
import { ErrorCodes } from '../errors/ErrorCodes';

export class RotationService implements IRotationService {
  constructor(
    private readonly batchRepo: IBatchRepository,
    private readonly generateBatchUseCase: GenerateBatchUseCase,
    private readonly settingsService: GameSettingsService = new GameSettingsService(),
    private readonly pool: DatabasePool = dbPool
  ) {}

  public async rotate(options: RotationOptions = {}): Promise<RotationResult> {
    // 1. Resolve target weekly cycle
    let cycleId = options.cycleId;
    if (!cycleId) {
      const cycleRes = await this.pool.query<{ id: string }>(
        `SELECT id FROM weekly_cycles WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1;`
      );
      if (!cycleRes.rows || cycleRes.rows.length === 0) {
        return {
          rotated: false,
          reason: 'NO_ACTIVE_CYCLE',
          activeBatch: null,
        };
      }
      cycleId = cycleRes.rows[0].id;
    }

    const now = options.now ?? new Date();

    // 2. Quick pre-check outside transaction to avoid lock contention
    const currentActive = await this.batchRepo.findActive(cycleId);
    if (currentActive && !options.force) {
      if (now < currentActive.expiresAt) {
        return {
          rotated: false,
          reason: 'CURRENT_BATCH_NOT_EXPIRED',
          activeBatch: currentActive,
        };
      }
    }

    // 3. Resolve authoritative game settings for rotation parameters
    const settings = await this.settingsService.getSettings();
    const intervalMinutes = options.intervalMinutes ?? settings.rotationIntervalMinutes;
    const count = options.count ?? settings.concurrentActiveSpawns;
    const minSeparation = options.minSeparationMeters ?? settings.minSpawnDistanceMeters;
    const allowPartial = options.allowPartial ?? false;

    // 4. Generate next valid batch in CREATED state before entering lock transaction
    const createdBatch = await this.generateBatchUseCase.execute({
      cycleId,
      count,
      minSeparationMeters: minSeparation,
      durationMinutes: intervalMinutes,
      allowPartial,
      startedAt: now,
    });

    // 5. Enter transaction with cycle row lock to serialize concurrent activation handoff
    try {
      return await transactionManager.runInTransaction(async (tx) => {
        // 5.1 Exclusive row lock on weekly cycle
        await this.batchRepo.lockCycle(cycleId!, tx);

        // 5.2 Double-checked locking: re-check active batch under lock
        const lockedActive = await this.batchRepo.findActive(cycleId!, tx);
        if (lockedActive && !options.force) {
          if (now < lockedActive.expiresAt) {
            // Another concurrent worker rotated while waiting for the lock
            // Expire our unneeded batch so it does not clutter CREATED state
            await this.batchRepo.expireBatch(createdBatch.id, tx);
            return {
              rotated: false,
              reason: 'CURRENT_BATCH_NOT_EXPIRED',
              activeBatch: lockedActive,
            };
          }
        }

        // 5.3 Atomically expire previous active batch (if any)
        let previousBatchId: string | null = null;
        if (lockedActive) {
          previousBatchId = lockedActive.id;
          await this.batchRepo.expireBatch(lockedActive.id, tx);
        }

        // 5.4 Atomically activate newly generated batch
        const activationTimestamp = options.now ?? new Date();
        await this.batchRepo.activateBatch(createdBatch.id, activationTimestamp, tx);

        const finalActive = await this.batchRepo.findById(createdBatch.id, tx);
        if (!finalActive) {
          throw new DomainError(
            `Failed to retrieve freshly activated spawn batch "${createdBatch.id}".`,
            ErrorCodes.INTERNAL_SERVER_ERROR
          );
        }

        // 5.5 Record rotation event in audit_logs
        const auditLogId = crypto.randomUUID();
        const actionName = options.adminId ? 'ADMIN_FORCE_ROTATION' : (options.force ? 'FORCE_ROTATION' : 'SPAWN_ROTATION');
        const adminId = options.adminId ?? null;
        const auditDetails = {
          previousBatchId,
          newBatchId: finalActive.id,
          batchNumber: finalActive.batchNumber,
          cycleId,
          spawnCount: finalActive.spawnIds.length,
          rotationIntervalMinutes: intervalMinutes,
          forced: !!options.force,
          adminId,
          activatedAt: activationTimestamp.toISOString(),
          expiresAt: finalActive.expiresAt.toISOString(),
        };

        await tx.query(
          `
          INSERT INTO audit_logs (
            id, admin_id, action, target_entity, target_id, details, created_at
          ) VALUES ($1, $2, $3, 'spawn_batch', $4, $5, $6);
          `,
          [auditLogId, adminId, actionName, finalActive.id, JSON.stringify(auditDetails), activationTimestamp]
        );

        // 5.6 Record rotation in analytics_events
        await tx.query(
          `
          INSERT INTO analytics_events (
            event_name, properties, created_at
          ) VALUES ('spawn_rotation_completed', $1, $2);
          `,
          [JSON.stringify(auditDetails), activationTimestamp]
        );

        return {
          rotated: true,
          reason: 'ROTATION_COMPLETED',
          activeBatch: finalActive,
          previousBatchId,
          rotationEventId: auditLogId,
        };
      });
    } catch (activationErr) {
      try {
        await this.batchRepo.expireBatch(createdBatch.id);
      } catch {
        // secondary cleanup failure ignored
      }
      throw activationErr;
    }
  }

  public async getNextRotationTime(cycleId?: string): Promise<Date | null> {
    let targetCycleId = cycleId;
    if (!targetCycleId) {
      const cycleRes = await this.pool.query<{ id: string }>(
        `SELECT id FROM weekly_cycles WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1;`
      );
      if (!cycleRes.rows || cycleRes.rows.length === 0) {
        return null;
      }
      targetCycleId = cycleRes.rows[0].id;
    }

    const activeBatch = await this.batchRepo.findActive(targetCycleId);
    return activeBatch?.expiresAt || null;
  }
}
