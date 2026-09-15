import { IWeeklyCycleRepository } from '../repositories/IWeeklyCycleRepository';
import { ResetWeeklyCycleUseCase } from './ResetWeeklyCycleUseCase';
import { ResetWeeklyCycleResultDTO } from './WeeklyCycleService';

export interface SchedulerCheckResult {
  checked: boolean;
  executed: boolean;
  reason?: string;
  cycleId?: string;
  result?: ResetWeeklyCycleResultDTO;
}

export interface WeeklyResetSchedulerOptions {
  checkIntervalMs?: number;
  autoStart?: boolean;
}

export class WeeklyResetScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly checkIntervalMs: number;

  constructor(
    private readonly weeklyCycleRepo: IWeeklyCycleRepository,
    private readonly resetWeeklyCycleUseCase: ResetWeeklyCycleUseCase,
    options: WeeklyResetSchedulerOptions = {}
  ) {
    this.checkIntervalMs = options.checkIntervalMs || 60000; // default 60 seconds

    if (options.autoStart) {
      this.start();
    }
  }

  /**
   * Checks if the active weekly cycle has reached or passed its ends_at timestamp.
   * If due, triggers the core transaction-safe weekly reset using a deterministic reset key: `scheduled:<cycle_id>`.
   */
  public async checkAndExecuteReset(currentTime: Date = new Date()): Promise<SchedulerCheckResult> {
    const activeCycle = await this.weeklyCycleRepo.getActiveCycle();

    if (!activeCycle) {
      return {
        checked: true,
        executed: false,
        reason: 'No active weekly cycle found.',
      };
    }

    if (activeCycle.status !== 'active' || activeCycle.completedAt) {
      return {
        checked: true,
        executed: false,
        reason: `Active cycle "${activeCycle.id}" is already completed or inactive.`,
        cycleId: activeCycle.id,
      };
    }

    // Check if the current time has reached or passed active cycle's ends_at
    if (currentTime.getTime() < activeCycle.endsAt.getTime()) {
      return {
        checked: true,
        executed: false,
        reason: `Cycle "${activeCycle.id}" is not due yet (ends at ${activeCycle.endsAt.toISOString()}, current: ${currentTime.toISOString()}).`,
        cycleId: activeCycle.id,
      };
    }

    // Cycle is due for reset!
    // Deterministic reset key per weekly cycle
    const resetKey = `scheduled:${activeCycle.id}`;

    const result = await this.resetWeeklyCycleUseCase.execute({
      resetKey,
      resetType: 'scheduled',
      triggeredByProfileId: null,
    });

    return {
      checked: true,
      executed: !result.duplicate,
      reason: result.duplicate
        ? `Scheduled reset for cycle "${activeCycle.id}" was already processed.`
        : `Scheduled reset for cycle "${activeCycle.id}" successfully executed.`,
      cycleId: activeCycle.id,
      result,
    };
  }

  /**
   * Starts the background periodic scheduler timer.
   */
  public start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(async () => {
      if (this.isProcessing) {
        return;
      }

      this.isProcessing = true;
      try {
        const checkResult = await this.checkAndExecuteReset();
        if (checkResult.executed) {
          console.log(`[WeeklyResetScheduler] ${checkResult.reason}`);
        }
      } catch (err) {
        console.error('[WeeklyResetScheduler] Error during scheduled reset check:', err);
      } finally {
        this.isProcessing = false;
      }
    }, this.checkIntervalMs);

    // Unref timer so it does not block Node process exit if running standalone
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops the background periodic scheduler timer.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public isRunning(): boolean {
    return this.timer !== null;
  }
}
