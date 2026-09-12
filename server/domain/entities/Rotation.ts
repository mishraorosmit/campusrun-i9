export interface RotationProps {
  id: string;
  rotationNumber: number;
  startedAt: Date;
  expiresAt: Date;
  totalSpawns: number;
  activeSpawns: number;
  nextRotationInSeconds: number;
}

export class Rotation {
  constructor(public readonly props: RotationProps) {}

  get id(): string {
    return this.props.id;
  }

  get rotationNumber(): number {
    return this.props.rotationNumber;
  }

  get isExpired(): boolean {
    return new Date() > this.props.expiresAt;
  }
}
