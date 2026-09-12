import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { BoundingBox, Coordinates } from '../domain/types';

export interface ISpawnRepository {
  findById(id: string): Promise<SpawnPoint | null>;
  findByCode(code: string): Promise<SpawnPoint | null>;
  findActive(): Promise<SpawnPoint[]>;
  findWithinBounds(bounds: BoundingBox): Promise<SpawnPoint[]>;
  findNearby(coords: Coordinates, radiusMeters: number): Promise<SpawnPoint[]>;
  save(spawn: SpawnPoint): Promise<void>;
  updateStatus(id: string, status: string, enabled?: boolean): Promise<void>;
}
