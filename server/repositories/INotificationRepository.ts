import { Notification } from '../domain/entities/Notification';

export interface INotificationRepository {
  findById(id: string): Promise<Notification | null>;
  findByUserId(userId: string, limit?: number, offset?: number): Promise<Notification[]>;
  getUnreadCount(userId: string): Promise<number>;
  markAsRead(id: string, userId: string): Promise<Notification | null>;
  markAllAsRead(userId: string): Promise<number>;
  save(notification: Notification): Promise<void>;
  saveBatch?(notifications: Notification[]): Promise<void>;
}
