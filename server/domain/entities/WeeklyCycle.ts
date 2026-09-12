import { WeeklyCycleStatus } from '../types';

export interface WeeklyCycleProps {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: WeeklyCycleStatus;
  createdAt: Date;
  completedAt?: Date | null;
}

export class WeeklyCycle {
  constructor(public readonly props: WeeklyCycleProps) {}

  get id(): string {
    return this.props.id;
  }

  get startsAt(): Date {
    return this.props.startsAt;
  }

  get endsAt(): Date {
    return this.props.endsAt;
  }

  get status(): WeeklyCycleStatus {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get completedAt(): Date | null | undefined {
    return this.props.completedAt;
  }

  get isActive(): boolean {
    return this.props.status === 'active';
  }

  get isCompleted(): boolean {
    return this.props.status === 'completed';
  }
}
