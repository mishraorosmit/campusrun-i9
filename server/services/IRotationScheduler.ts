import { RotationResult } from './IRotationService';

export interface RotationSchedulerStatus {
  isRunning: boolean;
  isRotating: boolean;
  nextRotationTime: Date | null;
  lastRotationTime: Date | null;
  lastError: string | null;
}

export interface IRotationScheduler {
  start(): Promise<void>;
  stop(): void;
  tick(): Promise<RotationResult>;
  getStatus(): Promise<RotationSchedulerStatus>;
  getNextRotationTime(): Promise<Date | null>;
}
