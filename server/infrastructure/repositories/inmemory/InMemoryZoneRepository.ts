import { IZoneRepository } from '../../../repositories/IZoneRepository';
import { CampusZone } from '../../../domain/entities/CampusZone';

export class InMemoryZoneRepository implements IZoneRepository {
  private zones: Map<string, CampusZone> = new Map();

  constructor(initialZones: CampusZone[] = []) {
    for (const zone of initialZones) {
      this.zones.set(zone.id, zone);
    }
  }

  async findAll(): Promise<CampusZone[]> {
    return Array.from(this.zones.values());
  }

  async findById(id: string): Promise<CampusZone | null> {
    return this.zones.get(id) || null;
  }

  async save(zone: CampusZone): Promise<void> {
    this.zones.set(zone.id, zone);
  }
}
