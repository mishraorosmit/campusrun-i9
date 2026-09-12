import { IRotationRepository } from '../../../repositories/IRotationRepository';
import { Rotation } from '../../../domain/entities/Rotation';

export class InMemoryRotationRepository implements IRotationRepository {
  private currentRotation: Rotation | null = null;

  constructor(initialRotation?: Rotation) {
    if (initialRotation) {
      this.currentRotation = initialRotation;
    }
  }

  async getCurrent(): Promise<Rotation | null> {
    return this.currentRotation;
  }

  async save(rotation: Rotation): Promise<void> {
    this.currentRotation = rotation;
  }
}
