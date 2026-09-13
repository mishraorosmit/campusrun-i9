import { IBatchRepository, BatchFilterOptions } from '../../../repositories/IBatchRepository';
import { SpawnBatch, SpawnBatchStatus, SpawnBatchProps } from '../../../domain/entities/SpawnBatch';
import { DatabasePool, dbPool } from '../../database/pool';
import { ITransactionContext } from '../../database/types';
import { NotFoundError } from '../../../errors/NotFoundError';

export class PostgresBatchRepository implements IBatchRepository {
  constructor(private readonly pool: DatabasePool = dbPool) {}

  private getExecutor(tx?: ITransactionContext): {
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
  } {
    return tx || this.pool;
  }

  public async create(batch: SpawnBatch, tx?: ITransactionContext): Promise<SpawnBatch> {
    const executor = this.getExecutor(tx);

    const sql = `
      INSERT INTO spawn_batches (
        id,
        batch_number,
        cycle_id,
        started_at,
        expires_at,
        status,
        is_active,
        created_at,
        spawn_ids
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
      RETURNING
        id,
        batch_number as "batchNumber",
        cycle_id as "cycleId",
        started_at as "startedAt",
        expires_at as "expiresAt",
        status,
        is_active as "isActive",
        created_at as "createdAt",
        spawn_ids::text[] as "spawnIds";
    `;

    const res = await executor.query<any>(sql, [
      batch.id,
      batch.batchNumber,
      batch.cycleId,
      batch.startedAt,
      batch.expiresAt,
      batch.status,
      batch.props.status === 'ACTIVE',
      batch.createdAt,
      batch.spawnIds,
    ]);

    // If spawns are associated, link them
    if (batch.spawnIds.length > 0) {
      await this.assignSpawns(batch.id, batch.spawnIds, tx);
    }

    return this.mapRowToBatch({
      ...res.rows[0],
      spawnIds: batch.spawnIds,
    });
  }

  public async update(batch: SpawnBatch, tx?: ITransactionContext): Promise<SpawnBatch> {
    const executor = this.getExecutor(tx);

    const sql = `
      UPDATE spawn_batches
      SET
        started_at = $2,
        expires_at = $3,
        status = $4,
        is_active = $5
      WHERE id = $1
      RETURNING
        id,
        batch_number as "batchNumber",
        cycle_id as "cycleId",
        started_at as "startedAt",
        expires_at as "expiresAt",
        status,
        is_active as "isActive",
        created_at as "createdAt";
    `;

    const res = await executor.query<any>(sql, [
      batch.id,
      batch.startedAt,
      batch.expiresAt,
      batch.status,
      batch.status === 'ACTIVE',
    ]);

    if (!res.rows || res.rows.length === 0) {
      throw new NotFoundError(`Spawn batch "${batch.id}" not found for update.`);
    }

    return this.mapRowToBatch({
      ...res.rows[0],
      spawnIds: batch.spawnIds,
    });
  }

  public async findById(id: string, tx?: ITransactionContext): Promise<SpawnBatch | null> {
    const executor = this.getExecutor(tx);

    const sql = `
      SELECT
        b.id,
        b.batch_number as "batchNumber",
        b.cycle_id as "cycleId",
        b.started_at as "startedAt",
        b.expires_at as "expiresAt",
        b.status,
        b.is_active as "isActive",
        b.created_at as "createdAt",
        COALESCE(NULLIF(b.spawn_ids::text[], '{}'), ARRAY_AGG(s.id::text) FILTER (WHERE s.id IS NOT NULL), '{}') as "spawnIds"
      FROM spawn_batches b
      LEFT JOIN spawn_points s ON s.batch_id = b.id
      WHERE b.id = $1
      GROUP BY b.id;
    `;

    const res = await executor.query<any>(sql, [id]);
    if (!res.rows || res.rows.length === 0) {
      return null;
    }

    return this.mapRowToBatch(res.rows[0]);
  }

  public async findByBatchNumber(batchNumber: number, tx?: ITransactionContext): Promise<SpawnBatch | null> {
    const executor = this.getExecutor(tx);

    const sql = `
      SELECT
        b.id,
        b.batch_number as "batchNumber",
        b.cycle_id as "cycleId",
        b.started_at as "startedAt",
        b.expires_at as "expiresAt",
        b.status,
        b.is_active as "isActive",
        b.created_at as "createdAt",
        COALESCE(NULLIF(b.spawn_ids::text[], '{}'), ARRAY_AGG(s.id::text) FILTER (WHERE s.id IS NOT NULL), '{}') as "spawnIds"
      FROM spawn_batches b
      LEFT JOIN spawn_points s ON s.batch_id = b.id
      WHERE b.batch_number = $1
      GROUP BY b.id;
    `;

    const res = await executor.query<any>(sql, [batchNumber]);
    if (!res.rows || res.rows.length === 0) {
      return null;
    }

    return this.mapRowToBatch(res.rows[0]);
  }

  public async findActive(cycleId?: string, tx?: ITransactionContext): Promise<SpawnBatch | null> {
    const executor = this.getExecutor(tx);

    const sql = `
      SELECT
        b.id,
        b.batch_number as "batchNumber",
        b.cycle_id as "cycleId",
        b.started_at as "startedAt",
        b.expires_at as "expiresAt",
        b.status,
        b.is_active as "isActive",
        b.created_at as "createdAt",
        COALESCE(NULLIF(b.spawn_ids::text[], '{}'), ARRAY_AGG(s.id::text) FILTER (WHERE s.id IS NOT NULL), '{}') as "spawnIds"
      FROM spawn_batches b
      LEFT JOIN spawn_points s ON s.batch_id = b.id
      WHERE ($1::uuid IS NULL OR b.cycle_id = $1)
        AND b.status = 'ACTIVE'
        AND b.is_active = true
      GROUP BY b.id
      ORDER BY b.started_at DESC
      LIMIT 1;
    `;

    const res = await executor.query<any>(sql, [cycleId || null]);
    if (!res.rows || res.rows.length === 0) {
      return null;
    }

    return this.mapRowToBatch(res.rows[0]);
  }

  public async findAll(options: BatchFilterOptions = {}): Promise<SpawnBatch[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (options.cycleId) {
      conditions.push(`b.cycle_id = $${idx++}`);
      params.push(options.cycleId);
    }

    if (options.status) {
      conditions.push(`b.status = $${idx++}`);
      params.push(options.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(options.limit || 50, 200);
    const offset = Math.max(options.offset || 0, 0);

    const sql = `
      SELECT
        b.id,
        b.batch_number as "batchNumber",
        b.cycle_id as "cycleId",
        b.started_at as "startedAt",
        b.expires_at as "expiresAt",
        b.status,
        b.is_active as "isActive",
        b.created_at as "createdAt",
        COALESCE(NULLIF(b.spawn_ids::text[], '{}'), ARRAY_AGG(s.id::text) FILTER (WHERE s.id IS NOT NULL), '{}') as "spawnIds"
      FROM spawn_batches b
      LEFT JOIN spawn_points s ON s.batch_id = b.id
      ${whereClause}
      GROUP BY b.id
      ORDER BY b.batch_number DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const res = await this.pool.query<any>(sql, params);
    return res.rows.map((r) => this.mapRowToBatch(r));
  }

  public async getNextBatchNumber(tx?: ITransactionContext): Promise<number> {
    const executor = this.getExecutor(tx);
    const sql = `SELECT COALESCE(MAX(batch_number), 0) + 1 as "nextNumber" FROM spawn_batches;`;
    const res = await executor.query<{ nextNumber: string | number }>(sql);
    return Number(res.rows[0]?.nextNumber || 1);
  }

  public async lockCycle(cycleId: string, tx: ITransactionContext): Promise<void> {
    await tx.query(`SELECT id FROM weekly_cycles WHERE id = $1 FOR UPDATE;`, [cycleId]);
  }

  public async assignSpawns(batchId: string, spawnIds: string[], tx?: ITransactionContext): Promise<void> {
    const executor = this.getExecutor(tx);
    if (spawnIds.length === 0) return;

    await executor.query(
      `UPDATE spawn_batches SET spawn_ids = $2 WHERE id = $1;`,
      [batchId, spawnIds]
    );

    await executor.query(
      `UPDATE spawn_points SET batch_id = $1 WHERE id = ANY($2::uuid[]);`,
      [batchId, spawnIds]
    );
  }

  public async activateBatch(batchId: string, startedAt: Date, tx: ITransactionContext): Promise<void> {
    // 1. Update batch status and ensure duration invariant (expires_at > started_at) holds
    const res = await tx.query<{ spawnIds: string[] }>(
      `UPDATE spawn_batches 
       SET status = 'ACTIVE', 
           is_active = true, 
           started_at = $2,
           expires_at = CASE WHEN expires_at <= $2 THEN $2 + INTERVAL '45 minutes' ELSE expires_at END
       WHERE id = $1 
       RETURNING spawn_ids::text[] as "spawnIds";`,
      [batchId, startedAt]
    );

    const spawnIds = res.rows[0]?.spawnIds || [];

    // 2. Atomically update member spawn points
    if (spawnIds.length > 0) {
      await tx.query(
        `UPDATE spawn_points SET batch_id = $1, status = 'active', enabled = true WHERE id = ANY($2::uuid[]);`,
        [batchId, spawnIds]
      );
    } else {
      await tx.query(
        `UPDATE spawn_points SET status = 'active', enabled = true WHERE batch_id = $1;`,
        [batchId]
      );
    }
  }

  public async expireBatch(batchId: string, tx?: ITransactionContext): Promise<void> {
    const executor = this.getExecutor(tx);

    // 1. Update batch status
    const res = await executor.query<{ spawnIds: string[] }>(
      `UPDATE spawn_batches SET status = 'EXPIRED', is_active = false WHERE id = $1 RETURNING spawn_ids::text[] as "spawnIds";`,
      [batchId]
    );

    const spawnIds = res.rows[0]?.spawnIds || [];

    // 2. Atomically update member spawn points to expired
    if (spawnIds.length > 0) {
      await executor.query(
        `UPDATE spawn_points SET status = 'expired' WHERE id = ANY($2::uuid[]) OR batch_id = $1;`,
        [batchId, spawnIds]
      );
    } else {
      await executor.query(
        `UPDATE spawn_points SET status = 'expired' WHERE batch_id = $1;`,
        [batchId]
      );
    }
  }

  private mapRowToBatch(row: any): SpawnBatch {
    const props: SpawnBatchProps = {
      id: row.id,
      batchNumber: Number(row.batchNumber),
      cycleId: row.cycleId,
      startedAt: new Date(row.startedAt),
      expiresAt: new Date(row.expiresAt),
      status: row.status as SpawnBatchStatus,
      spawnIds: Array.isArray(row.spawnIds) ? row.spawnIds : [],
      createdAt: new Date(row.createdAt),
    };

    return new SpawnBatch(props);
  }
}
