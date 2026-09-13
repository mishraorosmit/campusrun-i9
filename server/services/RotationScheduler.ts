import { IRotationScheduler, RotationSchedulerStatus } from './IRotationScheduler';
import { IRotationService, RotationResult } from './IRotationService';

export interface RotationSchedulerOptions {
  cycleId?: string;
  retryBackoffMs?: number;
  autoStart?: boolean;
}

export class RotationScheduler implements IRotationScheduler {
  private isRunning: boolean = false;
  private isRotating: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastRotationTime: Date | null = null;
  private lastError: string | null = null;

  private readonly retryBackoffMs: number;
  private readonly cycleId?: string;

  constructor(
    private readonly rotationService: IRotationService,
    options: RotationSchedulerOptions = {}
  ) {
    this.retryBackoffMs = options.retryBackoffMs ?? 30_000;
    this.cycleId = options.cycleId;

    if (options.autoStart) {
      this.start().catch((err) => {
        console.error('[RotationScheduler] Auto-start failed:', err);
      });
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Perform initial inspection / tick on startup to handle delayed restart or expired batches
    await this.tick();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public async tick(): Promise<RotationResult> {
    // Prevent overlapping executions
    if (this.isRotating) {
      return {
        rotated: false,
        reason: 'IDEMPOTENT_NO_OP',
        activeBatch: null,
      };
    }

    this.isRotating = true;
    let result: RotationResult;

    try {
      // Invoke rotation service, never duplicate its logic
      result = await this.rotationService.rotate({ cycleId: this.cycleId });

      if (result.rotated) {
        this.lastRotationTime = new Date();
        this.lastError = null;
      }
    } catch (err: any) {
      this.lastError = err.message || String(err);
      console.error('[RotationScheduler] Error during rotation tick:', err);
      result = {
        rotated: false,
        reason: 'IDEMPOTENT_NO_OP',
        activeBatch: null,
      };
    } finally {
      this.isRotating = false;
      if (this.isRunning) {
        await this.scheduleNext();
      }
    }

    return result;
  }

  public async getStatus(): Promise<RotationSchedulerStatus> {
    const nextRotationTime = await this.getNextRotationTime();
    return {
      isRunning: this.isRunning,
      isRotating: this.isRotating,
      nextRotationTime,
      lastRotationTime: this.lastRotationTime,
      lastError: this.lastError,
    };
  }

  public async getNextRotationTime(): Promise<Date | null> {
    // Authoritative next-rotation timestamp sourced from persisted batch state
    return this.rotationService.getNextRotationTime(this.cycleId);
  }

  private async scheduleNext(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.isRunning) return;

    // In case of error during previous attempt, schedule a backoff retry
    if (this.lastError) {
      this.timer = setTimeout(() => {
        this.tick().catch((err) => console.error('[RotationScheduler] Backoff retry tick failed:', err));
      }, this.retryBackoffMs);
      return;
    }

    const nextTime = await this.getNextRotationTime();
    let delayMs = 0;

    if (nextTime) {
      const remainingMs = nextTime.getTime() - Date.now();
      // If delayed execution or already past expiration, schedule immediately (delayMs = 0)
      delayMs = Math.max(0, remainingMs);
    } else {
      // No active batch found; trigger immediately to initialize first batch
      delayMs = 0;
    }

    // Node.js setTimeout maximum delay is 2^31 - 1 (~24.8 days)
    const safeDelay = Math.min(delayMs, 2147483647);

    this.timer = setTimeout(() => {
      this.tick().catch((err) => console.error('[RotationScheduler] Scheduled tick failed:', err));
    }, safeDelay);
  }
}
