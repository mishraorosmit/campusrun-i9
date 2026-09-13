import { ValidationError } from '../../errors/ValidationError';
import { DomainError } from '../../errors/DomainError';
import { ErrorCodes } from '../../errors/ErrorCodes';

export type SpawnBatchStatus = 'CREATED' | 'ACTIVE' | 'EXPIRED';

export interface SpawnBatchProps {
  id: string;
  batchNumber: number;
  cycleId: string;
  startedAt: Date;
  expiresAt: Date;
  status: SpawnBatchStatus;
  spawnIds: string[];
  createdAt?: Date;
}

export interface CreateSpawnBatchProps {
  id?: string;
  batchNumber: number;
  cycleId: string;
  startedAt: Date;
  expiresAt: Date;
  status?: SpawnBatchStatus;
  spawnIds?: string[];
  createdAt?: Date;
}

export class SpawnBatch {
  constructor(public readonly props: SpawnBatchProps) {
    SpawnBatch.validateProps(props);
  }

  public static validateProps(props: SpawnBatchProps): void {
    if (!props.id || typeof props.id !== 'string') {
      throw new ValidationError('Spawn batch ID is required and must be a string.');
    }
    if (typeof props.batchNumber !== 'number' || !Number.isInteger(props.batchNumber) || props.batchNumber <= 0) {
      throw new ValidationError(`Batch number must be a positive integer (got ${props.batchNumber}).`);
    }
    if (!props.cycleId || typeof props.cycleId !== 'string') {
      throw new ValidationError('Cycle ID is required and must be a string.');
    }
    if (!(props.startedAt instanceof Date) || isNaN(props.startedAt.getTime())) {
      throw new ValidationError('StartedAt must be a valid Date.');
    }
    if (!(props.expiresAt instanceof Date) || isNaN(props.expiresAt.getTime())) {
      throw new ValidationError('ExpiresAt must be a valid Date.');
    }
    if (props.expiresAt.getTime() <= props.startedAt.getTime()) {
      throw new ValidationError('Expiration timestamp must be strictly after started timestamp.');
    }
    if (!['CREATED', 'ACTIVE', 'EXPIRED'].includes(props.status)) {
      throw new ValidationError(`Invalid batch status "${props.status}". Must be CREATED, ACTIVE, or EXPIRED.`);
    }
    if (!Array.isArray(props.spawnIds)) {
      throw new ValidationError('spawnIds must be an array of spawn ID strings.');
    }
  }

  public static create(input: CreateSpawnBatchProps): SpawnBatch {
    const id = input.id || crypto.randomUUID();
    const props: SpawnBatchProps = {
      id,
      batchNumber: input.batchNumber,
      cycleId: input.cycleId,
      startedAt: input.startedAt,
      expiresAt: input.expiresAt,
      status: input.status ?? 'CREATED',
      spawnIds: input.spawnIds ? [...input.spawnIds] : [],
      createdAt: input.createdAt ?? new Date(),
    };

    return new SpawnBatch(props);
  }

  get id(): string {
    return this.props.id;
  }

  get batchNumber(): number {
    return this.props.batchNumber;
  }

  get cycleId(): string {
    return this.props.cycleId;
  }

  get startedAt(): Date {
    return this.props.startedAt;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get status(): SpawnBatchStatus {
    return this.props.status;
  }

  get spawnIds(): string[] {
    return [...this.props.spawnIds];
  }

  get createdAt(): Date {
    return this.props.createdAt ?? this.props.startedAt;
  }

  public isCreated(): boolean {
    return this.props.status === 'CREATED';
  }

  public isActive(): boolean {
    return this.props.status === 'ACTIVE' && new Date() <= this.props.expiresAt;
  }

  public isExpired(): boolean {
    return this.props.status === 'EXPIRED' || new Date() > this.props.expiresAt;
  }

  public hasSpawn(spawnId: string): boolean {
    return this.props.spawnIds.includes(spawnId);
  }

  /**
   * Evaluates if a transition to targetStatus is legally permitted.
   */
  public canTransitionTo(targetStatus: SpawnBatchStatus): boolean {
    // Idempotent: Transitioning to current status is always safe
    if (this.props.status === targetStatus) {
      return true;
    }

    switch (this.props.status) {
      case 'CREATED':
        // CREATED can transition to ACTIVE (normal activation) or EXPIRED (cancellation)
        return targetStatus === 'ACTIVE' || targetStatus === 'EXPIRED';

      case 'ACTIVE':
        // ACTIVE can only transition to EXPIRED
        return targetStatus === 'EXPIRED';

      case 'EXPIRED':
        // EXPIRED is terminal; cannot transition back to CREATED or ACTIVE
        return false;

      default:
        return false;
    }
  }

  /**
   * Executes a domain state transition, throwing DomainError on illegal transitions.
   * Safe and idempotent when called with current status.
   */
  public transitionTo(
    targetStatus: SpawnBatchStatus,
    options?: { startedAt?: Date; expiresAt?: Date }
  ): SpawnBatch {
    if (this.props.status === targetStatus) {
      return this; // Idempotent no-op
    }

    if (!this.canTransitionTo(targetStatus)) {
      throw new DomainError(
        `Illegal state transition: Cannot transition spawn batch from "${this.props.status}" to "${targetStatus}".`,
        ErrorCodes.DOMAIN_ERROR,
        { currentStatus: this.props.status, targetStatus }
      );
    }

    const startedAt = options?.startedAt ?? (targetStatus === 'ACTIVE' ? new Date() : this.props.startedAt);
    const expiresAt = options?.expiresAt ?? this.props.expiresAt;

    return new SpawnBatch({
      ...this.props,
      status: targetStatus,
      startedAt,
      expiresAt,
    });
  }

  public activate(startedAt?: Date): SpawnBatch {
    return this.transitionTo('ACTIVE', { startedAt });
  }

  public expire(): SpawnBatch {
    return this.transitionTo('EXPIRED');
  }

  public toJSON(): Record<string, any> {
    return {
      id: this.props.id,
      batchNumber: this.props.batchNumber,
      cycleId: this.props.cycleId,
      startedAt: this.props.startedAt.toISOString(),
      expiresAt: this.props.expiresAt.toISOString(),
      status: this.props.status,
      spawnIds: this.props.spawnIds,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
