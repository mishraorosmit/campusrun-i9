import { INotificationRepository } from '../../../repositories/INotificationRepository';
import { Notification, NotificationProps } from '../../../domain/entities/Notification';
import { dbPool } from '../../database/pool';

export class PostgresNotificationRepository implements INotificationRepository {
  constructor(private readonly pool: any = dbPool.getPool()) {}

  public async findById(id: string): Promise<Notification | null> {
    const res = await this.pool.query(
      `SELECT 
        id,
        user_id,
        type,
        title,
        body,
        read,
        read_at,
        entity_type,
        entity_id,
        created_at
       FROM notifications
       WHERE id = $1;`,
      [id]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToNotification(res.rows[0]);
  }

  public async findByUserId(userId: string, limit = 50, offset = 0): Promise<Notification[]> {
    const res = await this.pool.query(
      `SELECT 
        id,
        user_id,
        type,
        title,
        body,
        read,
        read_at,
        entity_type,
        entity_id,
        created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3;`,
      [userId, limit, offset]
    );

    return res.rows.map((row: any) => this.mapRowToNotification(row));
  }

  public async getUnreadCount(userId: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int as unread_count
       FROM notifications
       WHERE user_id = $1 AND read = false;`,
      [userId]
    );

    if (!res.rows || res.rows.length === 0 || res.rows[0].unread_count === undefined) {
      return 0;
    }

    return Number(res.rows[0].unread_count) || 0;
  }

  public async markAsRead(id: string, userId: string): Promise<Notification | null> {
    const res = await this.pool.query(
      `UPDATE notifications
       SET read = true,
           read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND user_id = $2
       RETURNING 
        id,
        user_id,
        type,
        title,
        body,
        read,
        read_at,
        entity_type,
        entity_id,
        created_at;`,
      [id, userId]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToNotification(res.rows[0]);
  }

  public async markAllAsRead(userId: string): Promise<number> {
    const res = await this.pool.query(
      `UPDATE notifications
       SET read = true,
           read_at = COALESCE(read_at, NOW())
       WHERE user_id = $1 AND read = false;`,
      [userId]
    );

    return res.rowCount !== null ? res.rowCount : 0;
  }

  public async save(notification: Notification): Promise<void> {
    await this.pool.query(
      `INSERT INTO notifications (
        id,
        user_id,
        type,
        title,
        body,
        read,
        read_at,
        entity_type,
        entity_id,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE
      SET read = EXCLUDED.read,
          read_at = EXCLUDED.read_at;`,
      [
        notification.id,
        notification.userId,
        notification.type,
        notification.title,
        notification.body,
        notification.read,
        notification.readAt || null,
        notification.entityType || null,
        notification.entityId || null,
        notification.createdAt,
      ]
    );
  }

  public async saveBatch(notifications: Notification[]): Promise<void> {
    if (notifications.length === 0) return;
    for (const notification of notifications) {
      await this.save(notification);
    }
  }

  private mapRowToNotification(row: any): Notification {
    const props: NotificationProps = {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      body: row.body,
      read: Boolean(row.read),
      readAt: row.read_at ? new Date(row.read_at) : null,
      entityType: row.entity_type || null,
      entityId: row.entity_id || null,
      createdAt: new Date(row.created_at),
    };

    return new Notification(props);
  }
}
