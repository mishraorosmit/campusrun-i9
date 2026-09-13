import { ISpawnRepository, SpawnFilterOptions, ActiveSpawnFilterOptions } from '../../../repositories/ISpawnRepository';
import { SpawnPoint } from '../../../domain/entities/SpawnPoint';
import { BoundingBox, Coordinates } from '../../../domain/types';
import { NotFoundError } from '../../../errors/NotFoundError';
import { GeoService } from '../../geo/GeoService';

export class InMemorySpawnRepository implements ISpawnRepository {
  private spawns: Map<string, SpawnPoint> = new Map();

  constructor(initialSpawns: SpawnPoint[] = []) {
    for (const spawn of initialSpawns) {
      this.spawns.set(spawn.id, spawn);
    }
  }

  async create(spawn: SpawnPoint): Promise<SpawnPoint> {
    this.spawns.set(spawn.id, spawn);
    return spawn;
  }

  async update(spawn: SpawnPoint): Promise<SpawnPoint> {
    if (!this.spawns.has(spawn.id)) {
      throw new NotFoundError(`Spawn point "${spawn.id}" not found.`);
    }
    this.spawns.set(spawn.id, spawn);
    return spawn;
  }

  async findById(id: string): Promise<SpawnPoint | null> {
    return this.spawns.get(id) || null;
  }

  async findByCode(code: string): Promise<SpawnPoint | null> {
    for (const spawn of this.spawns.values()) {
      if (spawn.code.toLowerCase() === code.toLowerCase()) return spawn;
    }
    return null;
  }

  async findAll(options: SpawnFilterOptions = {}): Promise<SpawnPoint[]> {
    let list = Array.from(this.spawns.values());

    if (options.status) {
      list = list.filter((s) => s.status === options.status);
    }
    if (options.enabled !== undefined) {
      list = list.filter((s) => s.isEnabled === options.enabled);
    }
    if (options.batchId) {
      list = list.filter((s) => s.batchId === options.batchId);
    }
    if (options.tier) {
      list = list.filter((s) => s.tier === options.tier);
    }

    const offset = options.offset || 0;
    const limit = options.limit || 100;
    return list.slice(offset, offset + limit);
  }

  async findActive(options: ActiveSpawnFilterOptions = {}): Promise<SpawnPoint[]> {
    let list = Array.from(this.spawns.values()).filter((s) => s.isActive());

    if (options.batchId) {
      list = list.filter((s) => s.batchId === options.batchId);
    }

    if (options.bounds) {
      const minLat = Math.min(options.bounds.northWest.lat, options.bounds.southEast.lat);
      const maxLat = Math.max(options.bounds.northWest.lat, options.bounds.southEast.lat);
      const minLng = Math.min(options.bounds.northWest.lng, options.bounds.southEast.lng);
      const maxLng = Math.max(options.bounds.northWest.lng, options.bounds.southEast.lng);

      list = list.filter((s) => {
        const { lat, lng } = s.coordinates;
        return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
      });
    }

    const offset = options.offset || 0;
    const limit = options.limit || 100;
    return list.slice(offset, offset + limit);
  }

  async findAvailableForBatch(limit: number = 10): Promise<SpawnPoint[]> {
    return Array.from(this.spawns.values())
      .filter((s) => s.isEnabled)
      .sort((a, b) => a.claimCount - b.claimCount)
      .slice(0, limit);
  }

  async findWithinBounds(bounds: BoundingBox): Promise<SpawnPoint[]> {
    const minLat = Math.min(bounds.northWest.lat, bounds.southEast.lat);
    const maxLat = Math.max(bounds.northWest.lat, bounds.southEast.lat);
    const minLng = Math.min(bounds.northWest.lng, bounds.southEast.lng);
    const maxLng = Math.max(bounds.northWest.lng, bounds.southEast.lng);

    return Array.from(this.spawns.values()).filter((spawn) => {
      const { lat, lng } = spawn.coordinates;
      return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
    });
  }

  async findNearby(coords: Coordinates, radiusMeters: number): Promise<SpawnPoint[]> {
    const validated = GeoService.validateCoordinates(coords);
    return Array.from(this.spawns.values()).filter((spawn) => {
      const dist = GeoService.distanceBetweenPoints(validated, spawn.coordinates);
      return dist <= radiusMeters;
    });
  }

  async save(spawn: SpawnPoint): Promise<void> {
    this.spawns.set(spawn.id, spawn);
  }

  async updateStatus(id: string, status: string, enabled?: boolean): Promise<void> {
    const existing = this.spawns.get(id);
    if (!existing) {
      throw new NotFoundError(`Spawn point "${id}" not found.`);
    }

    const updated = new SpawnPoint({
      ...existing.props,
      status: status as any,
      enabled: enabled !== undefined ? enabled : existing.props.enabled,
    });
    this.spawns.set(id, updated);
  }
}
