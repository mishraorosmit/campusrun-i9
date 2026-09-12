import { SpawnTier, Coordinates } from '../types';

export interface ClaimProps {
  id: string;
  spawnId: string;
  spawnCode: string;
  spawnTitle: string;
  playerId: string;
  zoneName: string;
  pointsAwarded: number;
  claimedAt: Date;
  tier: SpawnTier;
  playerCoordinates: Coordinates;
  distanceAtClaimMeters: number;
}

export class Claim {
  constructor(public readonly props: ClaimProps) {}

  get id(): string {
    return this.props.id;
  }

  get spawnId(): string {
    return this.props.spawnId;
  }

  get playerId(): string {
    return this.props.playerId;
  }

  get pointsAwarded(): number {
    return this.props.pointsAwarded;
  }

  get claimedAt(): Date {
    return this.props.claimedAt;
  }
}
