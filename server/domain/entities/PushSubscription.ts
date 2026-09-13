export interface PushSubscriptionProps {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PushSubscription {
  constructor(public readonly props: PushSubscriptionProps) {}

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get endpoint(): string {
    return this.props.endpoint;
  }

  get p256dh(): string {
    return this.props.p256dh;
  }

  get auth(): string {
    return this.props.auth;
  }

  get userAgent(): string | null | undefined {
    return this.props.userAgent;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
