import { CampusZone } from '../domain/entities/CampusZone';

export interface IZoneRepository {
  findAll(): Promise<CampusZone[]>;
  findById(id: string): Promise<CampusZone | null>;
  save(zone: CampusZone): Promise<void>;
}
