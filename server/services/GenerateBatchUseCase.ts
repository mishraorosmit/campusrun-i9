import { IBatchRepository } from '../repositories/IBatchRepository';
import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IGeospatialService } from './IGeospatialService';
import { GameSettingsService } from './GameSettingsService';
import { SpawnBatch } from '../domain/entities/SpawnBatch';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { GeoService } from '../infrastructure/geo/GeoService';
import { DomainError } from '../errors/DomainError';
import { ErrorCodes } from '../errors/ErrorCodes';
import { DatabasePool, dbPool } from '../infrastructure/database/pool';
import { transactionManager } from '../infrastructure/database/transaction';

export interface GenerateBatchOptions {
  cycleId?: string;
  count?: number;
  minSeparationMeters?: number;
  durationMinutes?: number;
  allowPartial?: boolean;
  excludeSpawnIds?: string[];
  candidatePoints?: SpawnPoint[];
  startedAt?: Date;
}

export class GenerateBatchUseCase {
  constructor(
    private readonly batchRepo: IBatchRepository,
    private readonly spawnRepo: ISpawnRepository,
    private readonly geoService: IGeospatialService,
    private readonly settingsService: GameSettingsService = new GameSettingsService(),
    private readonly pool: DatabasePool = dbPool
  ) {}

  public async execute(options: GenerateBatchOptions = {}): Promise<SpawnBatch> {
    // 1. Load authoritative game settings
    const settings = await this.settingsService.getSettings();
    const targetCount = options.count ?? settings.concurrentActiveSpawns;
    const minDistance = options.minSeparationMeters ?? settings.minSpawnDistanceMeters;
    const duration = options.durationMinutes ?? settings.rotationIntervalMinutes;
    const allowPartial = options.allowPartial ?? false;

    // 2. Resolve target weekly cycle
    let cycleId = options.cycleId;
    if (!cycleId) {
      const cycleRes = await this.pool.query<{ id: string }>(
        `SELECT id FROM weekly_cycles WHERE status = 'active' LIMIT 1;`
      );
      if (!cycleRes.rows || cycleRes.rows.length === 0) {
        throw new DomainError(
          'No active weekly cycle found for spawn batch generation.',
          ErrorCodes.DOMAIN_ERROR
        );
      }
      cycleId = cycleRes.rows[0].id;
    }

    // 3. Fetch candidate spawn points
    const inUseRes = await this.pool.query<{ id: string }>(
      `SELECT unnest(spawn_ids)::text as id FROM spawn_batches WHERE cycle_id = $1 AND status IN ('ACTIVE', 'CREATED')
       UNION
       SELECT id::text FROM spawn_points WHERE batch_id IN (
         SELECT id FROM spawn_batches WHERE cycle_id = $1 AND status IN ('ACTIVE', 'CREATED')
       );`,
      [cycleId]
    );
    const inUseSet = new Set<string>(inUseRes.rows.map((r) => r.id));
    if (options.excludeSpawnIds) {
      for (const id of options.excludeSpawnIds) inUseSet.add(id);
    }

    const allSpawns = options.candidatePoints ?? (await this.spawnRepo.findAll({ enabled: true, limit: 500 }));

    // 4. Validate inside campus boundary and exclude in-use / disabled points
    const eligibleSpawns: SpawnPoint[] = [];
    for (const spawn of allSpawns) {
      if (!options.candidatePoints && inUseSet.has(spawn.id)) continue;
      if (spawn.isEnabled) {
        const isInside = await this.geoService.isInsideCampus(spawn.coordinates);
        if (isInside) {
          eligibleSpawns.push(spawn);
        }
      }
    }

    if (eligibleSpawns.length === 0) {
      throw new DomainError(
        'Insufficient eligible spawn points: zero enabled in-campus spawn points found.',
        ErrorCodes.DOMAIN_ERROR
      );
    }

    // Sort by claim count ascending to promote unvisited areas, with deterministic fallback
    eligibleSpawns.sort((a, b) => {
      if (a.claimCount !== b.claimCount) {
        return a.claimCount - b.claimCount;
      }
      return a.code.localeCompare(b.code);
    });

    // 5. Select configured active count enforcing pairwise minimum distance
    const selected: SpawnPoint[] = [];

    for (const candidate of eligibleSpawns) {
      // Verify candidate is at least minDistance from all already selected spawns
      let satisfiesSeparation = true;
      for (const existing of selected) {
        const dist = GeoService.distanceBetweenPoints(candidate.coordinates, existing.coordinates);
        if (dist < minDistance) {
          satisfiesSeparation = false;
          break;
        }
      }

      if (satisfiesSeparation) {
        selected.push(candidate);
        if (selected.length === targetCount) {
          break;
        }
      }
    }

    // Check if sufficient points were found
    if (selected.length < targetCount && !allowPartial) {
      throw new DomainError(
        `Insufficient eligible spawn points: selected ${selected.length} of ${targetCount} configured points satisfying ${minDistance}m minimum separation.`,
        ErrorCodes.DOMAIN_ERROR,
        { selectedCount: selected.length, targetCount, minDistance }
      );
    }

    if (selected.length === 0) {
      throw new DomainError(
        `Insufficient eligible spawn points: unable to select any points satisfying ${minDistance}m separation.`,
        ErrorCodes.DOMAIN_ERROR
      );
    }

    // 6. Assign timestamps
    const startedAt = options.startedAt ?? new Date();
    const expiresAt = new Date(startedAt.getTime() + duration * 60 * 1000);

    // 7. Atomically create batch membership in CREATED state (do not publish until activated)
    return transactionManager.runInTransaction(async (tx) => {
      const nextBatchNumber = await this.batchRepo.getNextBatchNumber(tx);

      const batch = SpawnBatch.create({
        batchNumber: nextBatchNumber,
        cycleId: cycleId!,
        startedAt,
        expiresAt,
        status: 'CREATED',
        spawnIds: selected.map((s) => s.id),
      });

      const createdBatch = await this.batchRepo.create(batch, tx);
      await this.batchRepo.assignSpawns(createdBatch.id, createdBatch.spawnIds, tx);

      return createdBatch;
    });
  }
}
