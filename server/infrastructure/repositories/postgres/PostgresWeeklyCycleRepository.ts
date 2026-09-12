import { Pool } from 'pg';
import { IWeeklyCycleRepository, RecordResetEventDTO } from '../../../repositories/IWeeklyCycleRepository';
import { ITransactionContext } from '../../../repositories/ITransactionManager';
import { WeeklyCycle, WeeklyCycleSettings, WeeklyResetEvent } from '../../../domain/entities';

export class PostgresWeeklyCycleRepository implements IWeeklyCycleRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Retrieves the currently active weekly cycle, if any.
   */
  async getActiveCycle(): Promise<WeeklyCycle | null> {
    const res = await this.pool.query<{
      id: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      created_at: Date;
      completed_at: Date | null;
    }>(`
      SELECT id, starts_at, ends_at, status, created_at, completed_at
      FROM weekly_cycles
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 1;
    `);

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    const row = res.rows[0];
    return new WeeklyCycle({
      id: row.id,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      status: row.status as any,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    });
  }

  /**
   * Retrieves the currently active weekly cycle inside a transaction, optionally acquiring a FOR UPDATE row lock.
   */
  async getActiveCycleTx(tx: ITransactionContext, forUpdate = false): Promise<WeeklyCycle | null> {
    const lockClause = forUpdate ? 'FOR UPDATE' : '';
    const res = await tx.query<{
      id: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      created_at: Date;
      completed_at: Date | null;
    }>(`
      SELECT id, starts_at, ends_at, status, created_at, completed_at
      FROM weekly_cycles
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
      ${lockClause};
    `);

    if (!res.rows || res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return new WeeklyCycle({
      id: row.id,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      status: row.status as any,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    });
  }

  /**
   * Creates a new weekly cycle and returns the persisted entity.
   */
  async createCycle(cycle: { startsAt: Date; endsAt: Date; status: string }): Promise<WeeklyCycle> {
    const res = await this.pool.query<{
      id: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      created_at: Date;
      completed_at: Date | null;
    }>(`
      INSERT INTO weekly_cycles (starts_at, ends_at, status)
      VALUES ($1, $2, $3)
      RETURNING id, starts_at, ends_at, status, created_at, completed_at;
    `, [cycle.startsAt, cycle.endsAt, cycle.status]);

    const row = res.rows[0];
    return new WeeklyCycle({
      id: row.id,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      status: row.status as any,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    });
  }

  /**
   * Creates a new weekly cycle inside an existing transaction.
   */
  async createCycleTx(
    cycle: { startsAt: Date; endsAt: Date; status: string },
    tx: ITransactionContext
  ): Promise<WeeklyCycle> {
    const res = await tx.query<{
      id: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      created_at: Date;
      completed_at: Date | null;
    }>(`
      INSERT INTO weekly_cycles (starts_at, ends_at, status)
      VALUES ($1, $2, $3)
      RETURNING id, starts_at, ends_at, status, created_at, completed_at;
    `, [cycle.startsAt, cycle.endsAt, cycle.status]);

    const row = res.rows[0];
    return new WeeklyCycle({
      id: row.id,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      status: row.status as any,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
    });
  }

  /**
   * Marks a weekly cycle as completed with completed_at timestamp inside a transaction.
   */
  async completeCycleTx(cycleId: string, tx: ITransactionContext, completedAt: Date = new Date()): Promise<void> {
    await tx.query(`
      UPDATE weekly_cycles
      SET status = 'completed', completed_at = $2
      WHERE id = $1;
    `, [cycleId, completedAt]);
  }

  /**
   * Inserts a reset event into weekly_reset_events with unique reset_key protection.
   * Returns true if successfully inserted, false if the reset_key already exists (ON CONFLICT DO NOTHING).
   */
  async recordResetEventTx(event: RecordResetEventDTO, tx: ITransactionContext): Promise<boolean> {
    const executedAt = event.executedAt || new Date();
    const res = await tx.query<{ id: string }>(`
      INSERT INTO weekly_reset_events (
        cycle_id, reset_key, reset_type, triggered_by_profile_id, executed_at
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (reset_key) DO NOTHING
      RETURNING id;
    `, [
      event.cycleId,
      event.resetKey,
      event.resetType,
      event.triggeredByProfileId || null,
      executedAt,
    ]);

    return Boolean(res.rows && res.rows.length > 0);
  }

  /**
   * Looks up a weekly reset event by its unique reset key.
   */
  async getResetEventByKey(resetKey: string, tx?: ITransactionContext): Promise<WeeklyResetEvent | null> {
    const queryExecutor = tx || {
      query: async <T>(text: string, params: unknown[]) => {
        const res = await this.pool.query<any>(text, params);
        return { rows: res.rows as T[], rowCount: res.rowCount };
      },
    };

    const res = await queryExecutor.query<{
      id: string;
      cycle_id: string;
      reset_key: string;
      reset_type: string;
      triggered_by_profile_id: string | null;
      executed_at: Date;
    }>(`
      SELECT id, cycle_id, reset_key, reset_type, triggered_by_profile_id, executed_at
      FROM weekly_reset_events
      WHERE reset_key = $1
      LIMIT 1;
    `, [resetKey]);

    if (!res.rows || res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return new WeeklyResetEvent({
      id: row.id,
      cycleId: row.cycle_id,
      resetKey: row.reset_key,
      resetType: row.reset_type as any,
      triggeredByProfileId: row.triggered_by_profile_id,
      executedAt: new Date(row.executed_at),
    });
  }

  /**
   * Retrieves the singleton weekly cycle settings (id = 1).
   */
  async getSettings(): Promise<WeeklyCycleSettings | null> {
    const res = await this.pool.query<{
      id: number;
      reset_weekday: number;
      reset_time_utc: string;
      updated_at: Date;
    }>(`
      SELECT id, reset_weekday, reset_time_utc, updated_at
      FROM weekly_cycle_settings
      WHERE id = 1
      LIMIT 1;
    `);

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    const row = res.rows[0];
    return new WeeklyCycleSettings({
      id: Number(row.id),
      resetWeekday: Number(row.reset_weekday),
      resetTimeUtc: String(row.reset_time_utc),
      updatedAt: new Date(row.updated_at),
    });
  }

  /**
   * Retrieves the singleton weekly cycle settings inside a transaction.
   */
  async getSettingsTx(tx?: ITransactionContext): Promise<WeeklyCycleSettings | null> {
    if (!tx) {
      return this.getSettings();
    }

    const res = await tx.query<{
      id: number;
      reset_weekday: number;
      reset_time_utc: string;
      updated_at: Date;
    }>(`
      SELECT id, reset_weekday, reset_time_utc, updated_at
      FROM weekly_cycle_settings
      WHERE id = 1
      LIMIT 1;
    `);

    if (!res.rows || res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return new WeeklyCycleSettings({
      id: Number(row.id),
      resetWeekday: Number(row.reset_weekday),
      resetTimeUtc: String(row.reset_time_utc),
      updatedAt: new Date(row.updated_at),
    });
  }
}
