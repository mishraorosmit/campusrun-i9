import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { BoundingBox, Coordinates } from '../domain/types';
import { ITransactionContext } from '../infrastructure/database/types';

export interface SpawnFilterOptions {
  status?: string;
  enabled?: boolean;
  batchId?: string;
  tier?: string;
  limit?: number;
  offset?: number;
}

export interface ActiveSpawnFilterOptions {
  bounds?: BoundingBox;
  batchId?: string;
  limit?: number;
  offset?: number;
}

export interface ISpawnRepository {
  create(spawn: SpawnPoint, tx?: ITransactionContext): Promise<SpawnPoint>;
  update(spawn: SpawnPoint, tx?: ITransactionContext): Promise<SpawnPoint>;
  findById(id: string, tx?: ITransactionContext): Promise<SpawnPoint | null>;
  findByCode(code: string, tx?: ITransactionContext): Promise<SpawnPoint | null>;
  findAll(options?: SpawnFilterOptions): Promise<SpawnPoint[]>;
  findActive(options?: ActiveSpawnFilterOptions): Promise<SpawnPoint[]>;
  findAvailableForBatch(limit?: number): Promise<SpawnPoint[]>;
  findWithinBounds(bounds: BoundingBox): Promise<SpawnPoint[]>;
  findNearby(coords: Coordinates, radiusMeters: number): Promise<SpawnPoint[]>;
  save(spawn: SpawnPoint, tx?: ITransactionContext): Promise<void>;
  updateStatus(id: string, status: string, enabled?: boolean, tx?: ITransactionContext): Promise<void>;
}
