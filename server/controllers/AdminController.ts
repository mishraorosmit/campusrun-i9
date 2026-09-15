import { Request, Response, NextFunction } from 'express';
import { AdminManageSpawnsUseCase } from '../services/AdminManageSpawnsUseCase';
import { AdminCreateSpawnUseCase } from '../services/AdminCreateSpawnUseCase';
import { AdminEditSpawnUseCase } from '../services/AdminEditSpawnUseCase';
import { RotateSpawnsUseCase } from '../services/RotateSpawnsUseCase';
import { GetAdminOverviewUseCase } from '../services/GetAdminOverviewUseCase';
import { ResetWeeklyLeaderboardUseCase } from '../services/ResetWeeklyLeaderboardUseCase';
import { ResetWeeklyCycleUseCase } from '../services/ResetWeeklyCycleUseCase';
import { IWeeklyCycleRepository } from '../repositories/IWeeklyCycleRepository';
import { IRotationService } from '../services/IRotationService';
import { DatabasePool, dbPool } from '../infrastructure/database/pool';

export class AdminController {
  constructor(
    private readonly adminManageSpawnsUseCase: AdminManageSpawnsUseCase,
    private readonly rotateSpawnsUseCase: RotateSpawnsUseCase,
    private readonly getAdminOverviewUseCase: GetAdminOverviewUseCase,
    private readonly resetWeeklyLeaderboardUseCase?: ResetWeeklyLeaderboardUseCase,
    private readonly resetWeeklyCycleUseCase?: ResetWeeklyCycleUseCase,
    private readonly weeklyCycleRepo?: IWeeklyCycleRepository,
    private readonly adminCreateSpawnUseCase?: AdminCreateSpawnUseCase,
    private readonly adminEditSpawnUseCase?: AdminEditSpawnUseCase,
    private readonly rotationService?: IRotationService,
    private readonly pool: DatabasePool = dbPool
  ) {}

  public toggleSpawn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;
      const adminId = req.user?.id || null;

      const result = await this.adminManageSpawnsUseCase.toggleSpawn(id, enabled, adminId);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public triggerRotation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (this.rotationService) {
        const force = req.body?.force !== false;
        const adminId = req.user?.id || null;
        const count = req.body?.count !== undefined ? Number(req.body.count) : undefined;
        const intervalMinutes = req.body?.intervalMinutes !== undefined ? Number(req.body.intervalMinutes) : undefined;
        const minSeparationMeters = req.body?.minSeparationMeters !== undefined ? Number(req.body.minSeparationMeters) : undefined;
        const allowPartial = req.body?.allowPartial !== undefined ? Boolean(req.body.allowPartial) : undefined;

        const result = await this.rotationService.rotate({
          force,
          adminId,
          count,
          intervalMinutes,
          minSeparationMeters,
          allowPartial,
        });
        res.json({
          success: true,
          data: {
            batch: result.activeBatch?.toJSON() || null,
            previousBatchId: result.previousBatchId || null,
            rotationEventId: result.rotationEventId || null,
            reason: result.reason,
            rotated: result.rotated,
          },
        });
        return;
      }

      const result = await this.rotateSpawnsUseCase.execute();

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  public getOverview = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const overview = await this.getAdminOverviewUseCase.execute();

      res.json({
        success: true,
        data: overview,
      });
    } catch (err) {
      next(err);
    }
  };

  public resetWeeklyLeaderboard = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.resetWeeklyLeaderboardUseCase) {
        throw new Error('ResetWeeklyLeaderboardUseCase not configured');
      }

      const result = await this.resetWeeklyLeaderboardUseCase.execute();

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/admin/weekly-cycle/reset
   * Triggers manual weekly reset with deterministic key: `manual:<active_cycle_id>`
   */
  public resetWeeklyCycle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.resetWeeklyCycleUseCase) {
        throw new Error('ResetWeeklyCycleUseCase not configured');
      }

      let activeCycleId = 'initial';
      if (this.weeklyCycleRepo) {
        const activeCycle = await this.weeklyCycleRepo.getActiveCycle();
        if (activeCycle) {
          activeCycleId = activeCycle.id;
        }
      }

      const resetKey = (req.body?.resetKey as string) || `manual:${activeCycleId}`;
      const triggeredByProfileId = req.user?.id || (req.body?.triggeredByProfileId as string) || null;

      const result = await this.resetWeeklyCycleUseCase.execute({
        resetKey,
        resetType: 'manual',
        triggeredByProfileId,
      });

      res.status(200).json({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/v1/admin/weekly-cycle/manual-reset
   * Full atomic weekly cycle transition (new batch-engine implementation)
   */
  public manualWeeklyReset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // If use-case is available, delegate to it for consistent behavior
    if (this.resetWeeklyCycleUseCase) {
      return this.resetWeeklyCycle(req, res, next);
    }

    // Fallback: direct DB implementation from remote
    try {
      const adminId = req.user?.id || null;
      let newCycleId = '';
      let playersResetCount = 0;

      const client = await this.pool.getPool().connect();
      try {
        await client.query('BEGIN');

        const activeCycleRes = await client.query<any>(
          `SELECT id, cycle_number FROM weekly_cycles WHERE status = 'active' FOR UPDATE;`
        );
        let nextCycleNumber = 1;
        if (activeCycleRes.rowCount && activeCycleRes.rowCount > 0) {
          const oldCycleId = activeCycleRes.rows[0].id;
          nextCycleNumber = Number(activeCycleRes.rows[0].cycle_number) + 1;
          await client.query(
            `UPDATE weekly_cycles SET status = 'completed', finalized_at = NOW() WHERE id = $1;`,
            [oldCycleId]
          );
        }

        const cycleInsertRes = await client.query<any>(
          `INSERT INTO weekly_cycles (id, cycle_number, starts_at, ends_at, status)
           VALUES (gen_random_uuid(), $1, NOW(), NOW() + INTERVAL '7 days', 'active')
           RETURNING id;`,
          [nextCycleNumber]
        );
        newCycleId = cycleInsertRes.rows[0].id;

        const resetRes = await client.query<any>(
          `UPDATE profiles SET season_points = 0, updated_at = NOW();`
        );
        playersResetCount = resetRes.rowCount || 0;

        await client.query(
          `INSERT INTO audit_logs (id, admin_id, action, target_entity, target_id, details, created_at)
           VALUES (gen_random_uuid(), $1, 'WEEKLY_RESET_TRIGGER', 'weekly_cycles', $2, $3, NOW());`,
          [
            adminId,
            newCycleId,
            JSON.stringify({ previousCycleId: activeCycleRes.rows[0]?.id, playersResetCount }),
          ]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      let rotationResult = null;
      if (this.rotationService) {
        rotationResult = await this.rotationService.rotate({ force: true, adminId });
      }

      res.json({
        success: true,
        playersResetCount,
        message: `Weekly cycle reset executed successfully. ${playersResetCount} players reset.`,
        newCycleId,
        newBatchId: rotationResult?.activeBatch?.id || null,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * Planned Admin Routes (Guarded by requireAdmin)
   */
  public createSpawn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.adminCreateSpawnUseCase) {
        throw new Error('AdminCreateSpawnUseCase is not injected');
      }
      const adminId = req.user?.id || null;
      const spawn = await this.adminCreateSpawnUseCase.execute({
        ...req.body,
        adminId,
      });

      res.status(201).json({
        success: true,
        data: spawn.toJSON(),
      });
    } catch (err) {
      next(err);
    }
  };

  public editSpawn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!this.adminEditSpawnUseCase) {
        throw new Error('AdminEditSpawnUseCase is not injected');
      }
      const { id } = req.params;
      const adminId = req.user?.id || null;
      const spawn = await this.adminEditSpawnUseCase.execute({
        id,
        ...req.body,
        adminId,
      });

      res.json({
        success: true,
        data: spawn.toJSON(),
      });
    } catch (err) {
      next(err);
    }
  };

  public getRotationConfig = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const nextRotationTime = this.rotationService
        ? await this.rotationService.getNextRotationTime()
        : null;

      const settingsRes = await this.pool.query<any>(
        `SELECT key, value FROM game_settings WHERE key IN (
          'engine.rotation_interval_minutes',
          'engine.concurrent_active_spawns',
          'engine.min_spawn_distance_meters'
        );`
      );

      let intervalMinutes = 45;
      let concurrentActivePoints = 15;
      let minSpawnDistanceMeters = 60;

      for (const row of settingsRes.rows) {
        const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        const num = val?.value ?? val;
        if (row.key === 'engine.rotation_interval_minutes' && typeof num === 'number') {
          intervalMinutes = num;
        } else if (row.key === 'engine.concurrent_active_spawns' && typeof num === 'number') {
          concurrentActivePoints = num;
        } else if (row.key === 'engine.min_spawn_distance_meters' && typeof num === 'number') {
          minSpawnDistanceMeters = num;
        }
      }

      res.json({
        success: true,
        data: {
          intervalMinutes,
          concurrentActivePoints,
          minSpawnDistanceMeters,
          autoRotateEnabled: true,
          nextRotationTime,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public updateRotationConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminId = req.user?.id || null;
      const { intervalMinutes, concurrentActivePoints, minSpawnDistanceMeters } = req.body;

      if (intervalMinutes !== undefined) {
        await this.pool.query(
          `UPDATE game_settings SET value = jsonb_build_object('value', $2::numeric), updated_at = NOW(), updated_by = $3 WHERE key = $1;`,
          ['engine.rotation_interval_minutes', Number(intervalMinutes), adminId]
        );
      }
      if (concurrentActivePoints !== undefined) {
        await this.pool.query(
          `UPDATE game_settings SET value = jsonb_build_object('value', $2::numeric), updated_at = NOW(), updated_by = $3 WHERE key = $1;`,
          ['engine.concurrent_active_spawns', Number(concurrentActivePoints), adminId]
        );
      }
      if (minSpawnDistanceMeters !== undefined) {
        await this.pool.query(
          `UPDATE game_settings SET value = jsonb_build_object('value', $2::numeric), updated_at = NOW(), updated_by = $3 WHERE key = $1;`,
          ['engine.min_spawn_distance_meters', Number(minSpawnDistanceMeters), adminId]
        );
      }

      await this.pool.query(
        `INSERT INTO audit_logs (id, admin_id, action, target_entity, target_id, details, created_at)
         VALUES (gen_random_uuid(), $1, 'ROTATION_CONFIG_UPDATE', 'game_settings', gen_random_uuid(), $2, NOW());`,
        [adminId, JSON.stringify({ intervalMinutes, concurrentActivePoints, minSpawnDistanceMeters })]
      );

      res.json({
        success: true,
        message: 'Rotation configuration updated successfully.',
      });
    } catch (err) {
      next(err);
    }
  };

  public getWeeklyResetConfig = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cycleRes = await this.pool.query<any>(
        `SELECT id, cycle_number, starts_at, ends_at FROM weekly_cycles WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1;`
      );
      const cycle = cycleRes.rows[0];

      res.json({
        success: true,
        data: {
          resetDay: 'Sunday',
          resetTime: '11:59 PM',
          nextResetTimestamp: cycle?.ends_at || new Date(Date.now() + 7 * 86400000).toISOString(),
          lastResetTimestamp: cycle?.starts_at || new Date().toISOString(),
          activeCycleId: cycle?.id || null,
          activeCycleNumber: cycle?.cycle_number || null,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  public updateWeeklyResetConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminId = req.user?.id || null;
      const { resetDay, resetTime } = req.body;

      await this.pool.query(
        `INSERT INTO audit_logs (id, admin_id, action, target_entity, target_id, details, created_at)
         VALUES (gen_random_uuid(), $1, 'WEEKLY_RESET_CONFIG_UPDATE', 'weekly_cycles', gen_random_uuid(), $2, NOW());`,
        [adminId, JSON.stringify({ resetDay, resetTime })]
      );

      res.json({
        success: true,
        message: 'Weekly reset configuration updated successfully.',
      });
    } catch (err) {
      next(err);
    }
  };

  public getGameSettings = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resSettings = await this.pool.query<any>(
        `SELECT key, value, description, updated_at as "updatedAt" FROM game_settings ORDER BY key ASC;`
      );

      res.json({
        success: true,
        data: resSettings.rows,
      });
    } catch (err) {
      next(err);
    }
  };

  public updateGameSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const adminId = req.user?.id || null;
      const settings = req.body.settings || req.body;

      if (Array.isArray(settings)) {
        for (const item of settings) {
          if (item.key && item.value !== undefined) {
            const valObj = typeof item.value === 'object' ? item.value : { value: item.value };
            await this.pool.query(
              `UPDATE game_settings SET value = $2, updated_at = NOW(), updated_by = $3 WHERE key = $1;`,
              [item.key, JSON.stringify(valObj), adminId]
            );
          }
        }
      } else if (typeof settings === 'object') {
        for (const [key, value] of Object.entries(settings)) {
          const valObj = typeof value === 'object' ? value : { value };
          await this.pool.query(
            `UPDATE game_settings SET value = $2, updated_at = NOW(), updated_by = $3 WHERE key = $1;`,
            [key, JSON.stringify(valObj), adminId]
          );
        }
      }

      await this.pool.query(
        `INSERT INTO audit_logs (id, admin_id, action, target_entity, target_id, details, created_at)
         VALUES (gen_random_uuid(), $1, 'GAME_SETTINGS_UPDATE', 'game_settings', gen_random_uuid(), $2, NOW());`,
        [adminId, JSON.stringify(settings)]
      );

      res.json({
        success: true,
        message: 'Game settings updated successfully.',
      });
    } catch (err) {
      next(err);
    }
  };
}
