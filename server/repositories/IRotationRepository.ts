import { Rotation } from '../domain/entities/Rotation';

export interface IRotationRepository {
  getCurrent(): Promise<Rotation | null>;
  save(rotation: Rotation): Promise<void>;
}
