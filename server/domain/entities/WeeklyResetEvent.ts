import { ResetType } from '../types';

export interface WeeklyResetEventProps {
  id: string;
  cycleId: string;
  resetKey: string;
  resetType: ResetType;
  triggeredByProfileId?: string | null;
  executedAt: Date;
}

export class WeeklyResetEvent {
  constructor(public readonly props: WeeklyResetEventProps) {}

  get id(): string {
    return this.props.id;
  }

  get cycleId(): string {
    return this.props.cycleId;
  }

  get resetKey(): string {
    return this.props.resetKey;
  }

  get resetType(): ResetType {
    return this.props.resetType;
  }

  get triggeredByProfileId(): string | null | undefined {
    return this.props.triggeredByProfileId;
  }

  get executedAt(): Date {
    return this.props.executedAt;
  }
}
