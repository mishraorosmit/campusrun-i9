import { SpawnTier, SpawnStatus, Coordinates, SvgCoordinates } from '../types';
import { ValidationError } from '../../errors/ValidationError';

export interface SpawnPointProps {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  clue?: string | null;
  batchId?: string | null;
  zoneId?: string;
  zoneName?: string;
  coordinates: Coordinates;
  svgCoordinates: SvgCoordinates;
  points: number;
  tier: SpawnTier;
  status: SpawnStatus;
  claimRadiusMeters: number;
  enabled: boolean;
  spawnedAt?: Date | null;
  expiresAt?: Date | null;
  claimedBy?: string | null;
  claimedAt?: Date | null;
  claimCount: number;
  maxClaims?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateSpawnPointProps {
  id?: string;
  code: string;
  title: string;
  description?: string | null;
  clue?: string | null;
  batchId?: string | null;
  zoneId?: string;
  zoneName?: string;
  coordinates: Coordinates;
  svgCoordinates: SvgCoordinates;
  points?: number;
  tier?: SpawnTier;
  status?: SpawnStatus;
  claimRadiusMeters?: number;
  enabled?: boolean;
  maxClaims?: number | null;
  expiresAt?: Date | null;
}

export class SpawnPoint {
  constructor(public readonly props: SpawnPointProps) {
    SpawnPoint.validateProps(props);
  }

  public static validateProps(props: SpawnPointProps): void {
    if (!props.id || typeof props.id !== 'string') {
      throw new ValidationError('Spawn point ID is required and must be a string.');
    }
    if (!props.code || typeof props.code !== 'string' || props.code.trim().length < 3) {
      throw new ValidationError('Spawn code must be a string of at least 3 characters.');
    }
    if (!props.title || typeof props.title !== 'string' || props.title.trim().length === 0 || props.title.length > 100) {
      throw new ValidationError('Spawn title/name must be non-empty and up to 100 characters.');
    }
    if (!['tier1', 'tier2', 'tier3', 'tier4'].includes(props.tier)) {
      throw new ValidationError(`Invalid tier "${props.tier}". Must be one of: tier1, tier2, tier3, tier4.`);
    }
    if (typeof props.points !== 'number' || !Number.isInteger(props.points) || props.points <= 0) {
      throw new ValidationError('Points must be a positive integer greater than 0.');
    }
    if (typeof props.claimRadiusMeters !== 'number' || !Number.isFinite(props.claimRadiusMeters) || props.claimRadiusMeters < 5.0 || props.claimRadiusMeters > 150.0) {
      throw new ValidationError('Claim radius must be between 5.0 and 150.0 meters.');
    }
    if (!props.coordinates || typeof props.coordinates !== 'object') {
      throw new ValidationError('Coordinates object with lat and lng is required.');
    }
    const { lat, lng } = props.coordinates;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new ValidationError('Latitude must be a valid number between -90 and 90 degrees.');
    }
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new ValidationError('Longitude must be a valid number between -180 and 180 degrees.');
    }
    if (!props.svgCoordinates || typeof props.svgCoordinates !== 'object') {
      throw new ValidationError('SVG coordinates object with x and y is required.');
    }
    const { x, y } = props.svgCoordinates;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || typeof y !== 'number' || !Number.isFinite(y) || y < 0) {
      throw new ValidationError('SVG coordinates x and y must be non-negative numbers.');
    }
    if (!['active', 'claimed', 'cooldown', 'expired'].includes(props.status)) {
      throw new ValidationError(`Invalid status "${props.status}". Must be active, claimed, cooldown, or expired.`);
    }
    if (typeof props.enabled !== 'boolean') {
      throw new ValidationError('Enabled must be a boolean.');
    }
    if (typeof props.claimCount !== 'number' || !Number.isInteger(props.claimCount) || props.claimCount < 0) {
      throw new ValidationError('Claim count must be a non-negative integer.');
    }
    if (props.maxClaims !== undefined && props.maxClaims !== null) {
      if (typeof props.maxClaims !== 'number' || !Number.isInteger(props.maxClaims) || props.maxClaims <= 0) {
        throw new ValidationError('Max claims must be a positive integer if specified.');
      }
    }
  }

  public static create(input: CreateSpawnPointProps): SpawnPoint {
    const id = input.id || crypto.randomUUID();
    const props: SpawnPointProps = {
      id,
      code: input.code.trim().toUpperCase(),
      title: input.title.trim(),
      description: input.description ?? null,
      clue: input.clue ?? null,
      batchId: input.batchId ?? null,
      zoneId: input.zoneId ?? 'zone-canonical',
      zoneName: input.zoneName ?? 'Campus Core',
      coordinates: {
        lat: Number(input.coordinates.lat),
        lng: Number(input.coordinates.lng),
      },
      svgCoordinates: {
        x: Math.round(input.svgCoordinates.x),
        y: Math.round(input.svgCoordinates.y),
      },
      points: input.points ?? 100,
      tier: input.tier ?? 'tier1',
      status: input.status ?? 'active',
      claimRadiusMeters: input.claimRadiusMeters ?? 25.0,
      enabled: input.enabled !== undefined ? input.enabled : true,
      claimCount: 0,
      maxClaims: input.maxClaims ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return new SpawnPoint(props);
  }

  get id(): string {
    return this.props.id;
  }

  get code(): string {
    return this.props.code;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string | null | undefined {
    return this.props.description;
  }

  get clue(): string | null | undefined {
    return this.props.clue;
  }

  get batchId(): string | null | undefined {
    return this.props.batchId;
  }

  get points(): number {
    return this.props.points;
  }

  get tier(): SpawnTier {
    return this.props.tier;
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

  get svgCoordinates(): SvgCoordinates {
    return this.props.svgCoordinates;
  }

  get isEnabled(): boolean {
    return this.props.enabled;
  }

  get claimCount(): number {
    return this.props.claimCount;
  }

  get maxClaims(): number | null | undefined {
    return this.props.maxClaims;
  }

  get isExpired(): boolean {
    if (!this.props.expiresAt) return false;
    return new Date() > this.props.expiresAt;
  }

  public isActive(): boolean {
    return this.props.enabled && this.props.status === 'active' && !this.isExpired;
  }

  public toggleEnabled(enabled: boolean): SpawnPoint {
    return new SpawnPoint({
      ...this.props,
      enabled,
      updatedAt: new Date(),
    });
  }

  public update(changes: Partial<SpawnPointProps>): SpawnPoint {
    const updatedProps: SpawnPointProps = {
      ...this.props,
      ...changes,
      id: this.props.id, // ID is immutable
      updatedAt: new Date(),
    };
    return new SpawnPoint(updatedProps);
  }

  public toJSON(): Record<string, any> {
    return {
      id: this.props.id,
      code: this.props.code,
      title: this.props.title,
      description: this.props.description,
      clue: this.props.clue,
      batchId: this.props.batchId,
      zoneId: this.props.zoneId,
      zoneName: this.props.zoneName,
      coordinates: this.props.coordinates,
      svgCoordinates: this.props.svgCoordinates,
      lat: this.props.coordinates?.lat,
      lng: this.props.coordinates?.lng,
      svgX: this.props.svgCoordinates?.x,
      svgY: this.props.svgCoordinates?.y,
      points: this.props.points,
      tier: this.props.tier,
      status: this.props.status,
      claimRadiusMeters: this.props.claimRadiusMeters,
      enabled: this.props.enabled,
      claimCount: this.props.claimCount,
      maxClaims: this.props.maxClaims,
      expiresAt: this.props.expiresAt ? this.props.expiresAt.toISOString() : null,
      createdAt: this.props.createdAt ? this.props.createdAt.toISOString() : null,
      updatedAt: this.props.updatedAt ? this.props.updatedAt.toISOString() : null,
    };
  }
}
