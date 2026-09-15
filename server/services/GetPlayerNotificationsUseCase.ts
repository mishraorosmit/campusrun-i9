import { INotificationRepository } from '../repositories/INotificationRepository';
import { NotificationDTO } from './dtos';

export class GetPlayerNotificationsUseCase {
  constructor(private readonly notificationRepo: INotificationRepository) {}

  public async execute(userId: string, limit = 50, offset = 0): Promise<NotificationDTO[]> {
    const notifications = await this.notificationRepo.findByUserId(userId, limit, offset);

    return notifications.map((n) => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.read,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      entityType: n.entityType || null,
      entityId: n.entityId || null,
      createdAt: n.createdAt.toISOString(),
    }));
  }
}
