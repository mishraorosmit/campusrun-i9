import { INotificationRepository } from '../repositories/INotificationRepository';
import { ValidationError } from '../errors';

export interface MarkAllNotificationsReadResult {
  success: boolean;
  updatedCount: number;
}

export class MarkAllNotificationsReadUseCase {
  constructor(private readonly notificationRepo: INotificationRepository) {}

  public async execute(userId: string): Promise<MarkAllNotificationsReadResult> {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new ValidationError('User ID is required');
    }

    const updatedCount = await this.notificationRepo.markAllAsRead(userId.trim());

    return {
      success: true,
      updatedCount,
    };
  }
}

export { MarkAllNotificationsReadUseCase as MarkAllNotificationsAsReadUseCase };
