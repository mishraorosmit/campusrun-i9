import { INotificationRepository } from '../repositories/INotificationRepository';
import { ValidationError } from '../errors';

export class GetUnreadNotificationCountUseCase {
  constructor(private readonly notificationRepo: INotificationRepository) {}

  public async execute(userId: string): Promise<number> {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new ValidationError('User ID is required');
    }

    return this.notificationRepo.getUnreadCount(userId.trim());
  }
}
