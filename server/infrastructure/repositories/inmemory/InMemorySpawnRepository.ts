import { ISpawnRepository } from '../../../repositories/ISpawnRepository';
import { SpawnPoint } from '../../../domain/entities/SpawnPoint';
import { BoundingBox, Coordinates } from '../../../domain/types';

export class InMemorySpawnRepository implements ISpawnRepository {
  private spawns: Map<string, SpawnPoint> = new Map();

  constructor(initialSpawns: SpawnPoint[] = []) {
    for (const spawn of initialSpawns) {
      this.spawns.set(spawn.id, spawn);
    }
  }

  async findById(id: string): Promise<SpawnPoint | null> {
    return this.spawns.get(id) || null;
  }

  async findByCode(code: string): Promise<SpawnPoint | null> {
    for (const spawn of this.spawns.values()) {
      if (spawn.code === code) return spawn;
    }
    return null;
  }

  async findActive(): Promise<SpawnPoint[]> {
    const active: SpawnPoint[] = [];
    for (const spawn of this.spawns.values()) {
      if (spawn.isActive()) {
        active.push(spawn);
      }
    }
    return active;
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
    // Basic approximate bounding-box prefilter + exact filter
    const latDelta = radiusMeters / 111000;
    const lngDelta = radiusMeters / (111000 * Math.cos((coords.lat * Math.PI) / 180));

    return Array.from(this.spawns.values()).filter((spawn) => {
      const { lat, lng } = spawn.coordinates;
      return (
        Math.abs(lat - coords.lat) <= latDelta &&
        Math.abs(lng - coords.lng) <= lngDelta &&
        spawn.isActive()
      );
    });
  }

  async save(spawn: SpawnPoint): Promise<void> {
    this.spawns.set(spawn.id, spawn);
  }

  async updateStatus(id: string, status: string, enabled?: boolean): Promise<void> {
    const existing = this.spawns.get(id);
    if (!existing) return;

    const updated = new SpawnPoint({
      ...existing.props,
      status: status as any,
      enabled: enabled !== undefined ? enabled : existing.props.enabled,
    });
    this.spawns.set(id, updated);
  }
}
