import { SpawnBatch } from '../domain/entities/SpawnBatch';

export interface RotationOptions {
  cycleId?: string;
  intervalMinutes?: number;
  force?: boolean;
  now?: Date;
  minSeparationMeters?: number;
  count?: number;
  allowPartial?: boolean;
  adminId?: string | null;
}

export interface RotationResult {
  rotated: boolean;
  reason?: 'CURRENT_BATCH_NOT_EXPIRED' | 'NO_ACTIVE_CYCLE' | 'ROTATION_COMPLETED' | 'IDEMPOTENT_NO_OP';
  activeBatch: SpawnBatch | null;
  previousBatchId?: string | null;
  rotationEventId?: string | null;
}

export interface IRotationService {
  rotate(options?: RotationOptions): Promise<RotationResult>;
  getNextRotationTime(cycleId?: string): Promise<Date | null>;
}
