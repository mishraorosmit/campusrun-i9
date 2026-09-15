import { INotificationRepository } from '../repositories/INotificationRepository';
import { NotificationDTO } from './dtos';
import { NotFoundError, ValidationError } from '../errors';

export class MarkNotificationAsReadUseCase {
  constructor(private readonly notificationRepo: INotificationRepository) {}

  public async execute(userId: string, notificationId: string): Promise<NotificationDTO> {
    if (!notificationId || typeof notificationId !== 'string' || notificationId.trim() === '') {
      throw new ValidationError('Notification identifier is required');
    }

    const updated = await this.notificationRepo.markAsRead(notificationId.trim(), userId);
    if (!updated) {
      throw new NotFoundError(`Notification with id "${notificationId}" not found for current user`);
    }

    return {
      id: updated.id,
      userId: updated.userId,
      type: updated.type,
      title: updated.title,
      body: updated.body,
      read: updated.read,
      readAt: updated.readAt ? updated.readAt.toISOString() : null,
      entityType: updated.entityType || null,
      entityId: updated.entityId || null,
      createdAt: updated.createdAt.toISOString(),
    };
  }
}

export { MarkNotificationAsReadUseCase as MarkNotificationReadUseCase };

