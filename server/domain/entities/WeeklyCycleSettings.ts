export interface WeeklyCycleSettingsProps {
  id: number;
  resetWeekday: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  resetTimeUtc: string; // HH:mm:ss format e.g. "23:59:00"
  updatedAt: Date;
}

export class WeeklyCycleSettings {
  constructor(public readonly props: WeeklyCycleSettingsProps) {
    if (props.resetWeekday < 0 || props.resetWeekday > 6) {
      throw new Error(`Invalid reset_weekday: ${props.resetWeekday}. Must be between 0 (Sunday) and 6 (Saturday).`);
    }
  }

  get id(): number {
    return this.props.id;
  }

  get resetWeekday(): number {
    return this.props.resetWeekday;
  }

  get resetTimeUtc(): string {
    return this.props.resetTimeUtc;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
