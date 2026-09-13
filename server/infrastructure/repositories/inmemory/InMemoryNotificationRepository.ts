import { INotificationRepository } from '../../../repositories/INotificationRepository';
import { Notification } from '../../../domain/entities/Notification';

export class InMemoryNotificationRepository implements INotificationRepository {
  private notifications: Map<string, Notification> = new Map();

  constructor(initialNotifications: Notification[] = []) {
    for (const notification of initialNotifications) {
      this.notifications.set(notification.id, notification);
    }
  }

  public async findById(id: string): Promise<Notification | null> {
    return this.notifications.get(id) || null;
  }

  public async findByUserId(userId: string, limit = 50, offset = 0): Promise<Notification[]> {
    return Array.from(this.notifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  public async getUnreadCount(userId: string): Promise<number> {
    return Array.from(this.notifications.values()).filter(
      (n) => n.userId === userId && !n.read
    ).length;
  }

  public async markAsRead(id: string, userId: string): Promise<Notification | null> {
    const notification = this.notifications.get(id);
    if (!notification || notification.userId !== userId) {
      return null;
    }

    const updated = notification.markAsRead(new Date());
    this.notifications.set(id, updated);
    return updated;
  }

  public async markAllAsRead(userId: string): Promise<number> {
    let count = 0;
    const now = new Date();
    for (const [id, notif] of this.notifications.entries()) {
      if (notif.userId === userId && !notif.read) {
        const updated = notif.markAsRead(now);
        this.notifications.set(id, updated);
        count++;
      }
    }
    return count;
  }

  public async save(notification: Notification): Promise<void> {
    this.notifications.set(notification.id, notification);
  }

  public async saveBatch(notifications: Notification[]): Promise<void> {
    for (const notification of notifications) {
      this.notifications.set(notification.id, notification);
    }
  }
}
