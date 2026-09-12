import { SpawnTier, SpawnStatus, Coordinates, SvgCoordinates } from '../types';

export interface SpawnPointProps {
  id: string;
  code: string;
  title: string;
  description?: string;
  clue?: string;
  zoneId: string;
  zoneName: string;
  coordinates: Coordinates;
  svgCoordinates: SvgCoordinates;
  points: number;
  tier: SpawnTier;
  status: SpawnStatus;
  claimRadiusMeters: number;
  enabled: boolean;
  spawnedAt?: Date;
  expiresAt: Date;
  claimedBy?: string;
  claimedAt?: Date;
  claimCount: number;
  maxClaims?: number;
}

export class SpawnPoint {
  constructor(public readonly props: SpawnPointProps) {}

  get id(): string {
    return this.props.id;
  }

  get code(): string {
    return this.props.code;
  }

  get points(): number {
    return this.props.points;
  }

  get status(): SpawnStatus {
    return this.props.status;
  }

  get claimRadiusMeters(): number {
    return this.props.claimRadiusMeters;
  }

  get coordinates(): Coordinates {
    return this.props.coordinates;
  }

  get isEnabled(): boolean {
    return this.props.enabled;
  }

  get isExpired(): boolean {
    return new Date() > this.props.expiresAt;
  }

  public isActive(): boolean {
    return this.props.enabled && this.props.status === 'active' && !this.isExpired;
  }
}
