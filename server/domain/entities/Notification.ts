import { NotificationType } from '../types';

export interface NotificationProps {
  id: string;
  userId: string;
  type: NotificationType | string;
  title: string;
  body: string;
  read: boolean;
  readAt?: Date | null;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: Date;
}

export class Notification {
  constructor(public readonly props: NotificationProps) {}

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get type(): string {
    return this.props.type;
  }

  get title(): string {
    return this.props.title;
  }

  get body(): string {
    return this.props.body;
  }

  get read(): boolean {
    return this.props.read;
  }

  get readAt(): Date | null | undefined {
    return this.props.readAt;
  }

  get entityType(): string | null | undefined {
    return this.props.entityType;
  }

  get entityId(): string | null | undefined {
    return this.props.entityId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  public markAsRead(readAt: Date = new Date()): Notification {
    return new Notification({
      ...this.props,
      read: true,
      readAt,
    });
  }
}
