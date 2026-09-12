import { PlayerRole } from '../types';

export interface PlayerProps {
  id: string;
  email: string;
  username: string;
  avatarUrl?: string;
  totalPoints: number;
  seasonPoints: number;
  rank: number;
  tier: string;
  claimsCount: number;
  currentStreakDays: number;
  campusZone?: string;
  role: PlayerRole;
  createdAt: Date;
  lastActiveAt: Date;
}

export class Player {
  constructor(public readonly props: PlayerProps) {}

  get id(): string {
    return this.props.id;
  }

  get username(): string {
    return this.props.username;
  }

  get role(): PlayerRole {
    return this.props.role;
  }

  get totalPoints(): number {
    return this.props.totalPoints;
  }

  get currentStreakDays(): number {
    return this.props.currentStreakDays;
  }

  public isAdmin(): boolean {
    return this.props.role === 'admin' || this.props.role === 'superadmin';
  }
}
