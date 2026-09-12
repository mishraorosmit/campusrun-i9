import { IWeeklyCycleRepository } from '../repositories/IWeeklyCycleRepository';
import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';
import { ITransactionManager, ITransactionContext, IQueryResult } from '../repositories/ITransactionManager';
import { WeeklyCycle, WeeklyCycleSettings } from '../domain/entities';
import { ResetType } from '../domain/types';

export interface NextResetDTO {
  nextResetAt: string;
  cycleId: string;
  startsAt: string;
  status: string;
}

export interface ResetWeeklyCycleInputDTO {
  resetKey: string;
  resetType: ResetType;
  triggeredByProfileId?: string | null;
}

export interface ResetWeeklyCycleResultDTO {
  success: boolean;
  duplicate: boolean;
  resetKey: string;
  resetType: ResetType;
  cycleId?: string;
  nextCycleId?: string;
  nextResetAt?: string;
  executedAt: string;
  message: string;
}

/**
 * Calculates the next deterministic UTC reset timestamp given cycle settings.
 * All calculations are strictly UTC-based and timezone-invariant.
 */
export function calculateNextResetTimestamp(
  settings: { resetWeekday: number; resetTimeUtc: string },
  fromDate: Date = new Date()
): Date {
  const { resetWeekday, resetTimeUtc } = settings;

  const timeParts = (resetTimeUtc || '23:59:00').split(':').map((p) => parseInt(p, 10));
  const hours = !isNaN(timeParts[0]) ? timeParts[0] : 23;
  const minutes = !isNaN(timeParts[1]) ? timeParts[1] : 59;
  const seconds = !isNaN(timeParts[2]) ? timeParts[2] : 0;

  const currentYear = fromDate.getUTCFullYear();
  const currentMonth = fromDate.getUTCMonth();
  const currentDay = fromDate.getUTCDate();
  const currentWeekday = fromDate.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  // Construct target candidate on the current calendar day in UTC
  const candidate = new Date(Date.UTC(currentYear, currentMonth, currentDay, hours, minutes, seconds, 0));

  const dayDiff = (resetWeekday - currentWeekday + 7) % 7;

  if (dayDiff === 0) {
    // Target is today. If the time today is strictly in the future, return it
    if (candidate.getTime() > fromDate.getTime()) {
      return candidate;
    }
    // Otherwise, the reset for today has passed; jump to next week (7 days)
    candidate.setUTCDate(candidate.getUTCDate() + 7);
    return candidate;
  }

  // Target is on a future day this week
  candidate.setUTCDate(candidate.getUTCDate() + dayDiff);
  return candidate;
}

export class WeeklyCycleService {
  private readonly txManager: ITransactionManager;

  constructor(
    private readonly weeklyCycleRepo: IWeeklyCycleRepository,
    private readonly leaderboardRepo?: ILeaderboardRepository,
    txManager?: ITransactionManager
  ) {
    this.txManager = txManager || {
      runInTransaction: async <T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> => {
        const fallbackTx: ITransactionContext = {
          query: async <R = Record<string, unknown>>(): Promise<IQueryResult<R>> => {
            return { rows: [] as R[], rowCount: 0 };
          },
        };
        return work(fallbackTx);
      },
    };
  }

  /**
   * Calculates the next reset timestamp from configured settings or defaults.
   */
  public async calculateNextReset(fromDate: Date = new Date()): Promise<Date> {
    const settings = await this.weeklyCycleRepo.getSettings();
    const config = settings
      ? { resetWeekday: settings.resetWeekday, resetTimeUtc: settings.resetTimeUtc }
      : { resetWeekday: 0, resetTimeUtc: '23:59:00' };

    return calculateNextResetTimestamp(config, fromDate);
  }

  /**
   * Retrieves the current active weekly cycle.
   * If no active cycle exists, safely creates one ending at the next calculated reset time without resetting scores.
   */
  public async getActiveCycle(currentDate: Date = new Date()): Promise<WeeklyCycle> {
    const active = await this.weeklyCycleRepo.getActiveCycle();

    if (active && active.status === 'active' && !active.completedAt) {
      return active;
    }

    // No active cycle found -> create a new one ending at next reset timestamp
    const nextReset = await this.calculateNextReset(currentDate);

    const newCycle = await this.weeklyCycleRepo.createCycle({
      startsAt: currentDate,
      endsAt: nextReset,
      status: 'active',
    });

    return newCycle;
  }

  /**
   * Exposes the next reset timestamp.
   * If an active cycle exists and has not been completed, returns its ends_at.
   * If no active cycle exists, creates/initializes one and returns its ends_at.
   */
  public async getNextResetTimestamp(currentDate: Date = new Date()): Promise<NextResetDTO> {
    const cycle = await this.getActiveCycle(currentDate);

    return {
      nextResetAt: cycle.endsAt.toISOString(),
      cycleId: cycle.id,
      startsAt: cycle.startsAt.toISOString(),
      status: cycle.status,
    };
  }

  /**
   * Resets weekly scores safely inside a single PostgreSQL transaction while strictly
   * preserving all-time points and claim history. Uses resetKey for idempotency.
   */
  public async resetWeeklyCycle(input: ResetWeeklyCycleInputDTO): Promise<ResetWeeklyCycleResultDTO> {
    const { resetKey, resetType, triggeredByProfileId } = input;

    return this.txManager.runInTransaction(async (tx) => {
      // 1. Idempotency Check: check if this reset key has already been recorded
      const existingEvent = await this.weeklyCycleRepo.getResetEventByKey(resetKey, tx);
      if (existingEvent) {
        return {
          success: true,
          duplicate: true,
          resetKey,
          resetType,
          cycleId: existingEvent.cycleId,
          executedAt: existingEvent.executedAt.toISOString(),
          message: `Weekly reset with key "${resetKey}" has already been executed.`,
        };
      }

      // 2. Lock current active weekly cycle
      let activeCycle = await this.weeklyCycleRepo.getActiveCycleTx(tx, true);
      const now = new Date();

      if (!activeCycle) {
        // Safe fallback: create an initial completed cycle so FK reference is valid
        activeCycle = await this.weeklyCycleRepo.createCycleTx(
          {
            startsAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
            endsAt: now,
            status: 'active',
          },
          tx
        );
      }

      // 3. Record reset event with unique reset_key (Atomic race protection)
      const recorded = await this.weeklyCycleRepo.recordResetEventTx(
        {
          cycleId: activeCycle.id,
          resetKey,
          resetType,
          triggeredByProfileId: triggeredByProfileId || null,
          executedAt: now,
        },
        tx
      );

      if (!recorded) {
        // Another concurrent worker recorded this key
        return {
          success: true,
          duplicate: true,
          resetKey,
          resetType,
          cycleId: activeCycle.id,
          executedAt: now.toISOString(),
          message: `Weekly reset with key "${resetKey}" was recorded concurrently.`,
        };
      }

      // 4. Reset all weekly/season points to 0 (total_points & claims are strictly preserved)
      if (this.leaderboardRepo?.resetWeeklyTx) {
        await this.leaderboardRepo.resetWeeklyTx(tx);
      } else if (this.leaderboardRepo) {
        await this.leaderboardRepo.resetWeekly();
      } else {
        await tx.query('UPDATE profiles SET season_points = 0');
      }

      // 5. Mark the current active weekly cycle as completed
      await this.weeklyCycleRepo.completeCycleTx(activeCycle.id, tx, now);

      // 6. Calculate next reset time and create the next active cycle
      const settings = await this.weeklyCycleRepo.getSettingsTx(tx);
      const config = settings
        ? { resetWeekday: settings.resetWeekday, resetTimeUtc: settings.resetTimeUtc }
        : { resetWeekday: 0, resetTimeUtc: '23:59:00' };

      const nextResetAt = calculateNextResetTimestamp(config, now);

      const nextActiveCycle = await this.weeklyCycleRepo.createCycleTx(
        {
          startsAt: now,
          endsAt: nextResetAt,
          status: 'active',
        },
        tx
      );

      return {
        success: true,
        duplicate: false,
        resetKey,
        resetType,
        cycleId: activeCycle.id,
        nextCycleId: nextActiveCycle.id,
        nextResetAt: nextActiveCycle.endsAt.toISOString(),
        executedAt: now.toISOString(),
        message: `Weekly cycle completed and scores reset. Next cycle ${nextActiveCycle.id} active.`,
      };
    });
  }
}
