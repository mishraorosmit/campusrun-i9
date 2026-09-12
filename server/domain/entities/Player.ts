import { PlayerRole } from '../types';

export interface PlayerProps {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  status?: 'active' | 'suspended' | 'deactivated';
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

  get isActive(): boolean {
    return !this.props.status || this.props.status === 'active';
  }

  public isAdmin(): boolean {
    return this.props.role === 'ADMIN';
  }

  public isStudent(): boolean {
    return this.props.role === 'STUDENT';
  }
}

