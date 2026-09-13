import { IPushSubscriptionRepository } from '../../../repositories/IPushSubscriptionRepository';
import { PushSubscription, PushSubscriptionProps } from '../../../domain/entities/PushSubscription';
import { dbPool } from '../../database/pool';

export class PostgresPushSubscriptionRepository implements IPushSubscriptionRepository {
  constructor(private readonly pool: any = dbPool.getPool()) {}

  public async saveOrUpdate(subscription: PushSubscription): Promise<PushSubscription> {
    const res = await this.pool.query(
      `INSERT INTO push_subscriptions (
        id,
        user_id,
        endpoint,
        p256dh,
        auth,
        user_agent,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (endpoint) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent),
          updated_at = NOW()
      RETURNING 
        id,
        user_id,
        endpoint,
        p256dh,
        auth,
        user_agent,
        created_at,
        updated_at;`,
      [
        subscription.id,
        subscription.userId,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        subscription.userAgent || null,
        subscription.createdAt,
        subscription.updatedAt,
      ]
    );

    return this.mapRowToPushSubscription(res.rows[0]);
  }

  public async findByEndpoint(endpoint: string): Promise<PushSubscription | null> {
    const res = await this.pool.query(
      `SELECT 
        id,
        user_id,
        endpoint,
        p256dh,
        auth,
        user_agent,
        created_at,
        updated_at
       FROM push_subscriptions
       WHERE endpoint = $1;`,
      [endpoint]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToPushSubscription(res.rows[0]);
  }

  public async findById(id: string): Promise<PushSubscription | null> {
    const res = await this.pool.query(
      `SELECT 
        id,
        user_id,
        endpoint,
        p256dh,
        auth,
        user_agent,
        created_at,
        updated_at
       FROM push_subscriptions
       WHERE id = $1;`,
      [id]
    );

    if (res.rowCount === 0 || !res.rows[0]) {
      return null;
    }

    return this.mapRowToPushSubscription(res.rows[0]);
  }

  public async findByUserId(userId: string): Promise<PushSubscription[]> {
    const res = await this.pool.query(
      `SELECT 
        id,
        user_id,
        endpoint,
        p256dh,
        auth,
        user_agent,
        created_at,
        updated_at
       FROM push_subscriptions
       WHERE user_id = $1;`,
      [userId]
    );

    return res.rows.map((row: any) => this.mapRowToPushSubscription(row));
  }

  public async findAll(): Promise<PushSubscription[]> {
    const res = await this.pool.query(
      `SELECT 
        id,
        user_id,
        endpoint,
        p256dh,
        auth,
        user_agent,
        created_at,
        updated_at
       FROM push_subscriptions;`
    );

    return res.rows.map((row: any) => this.mapRowToPushSubscription(row));
  }

  public async deleteByEndpoint(endpoint: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM push_subscriptions
       WHERE endpoint = $1;`,
      [endpoint]
    );

    return res.rowCount !== null && res.rowCount > 0;
  }

  public async deleteByEndpointAndUserId(endpoint: string, userId: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM push_subscriptions
       WHERE endpoint = $1 AND user_id = $2;`,
      [endpoint, userId]
    );

    return res.rowCount !== null && res.rowCount > 0;
  }

  public async deleteByIdAndUserId(id: string, userId: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM push_subscriptions
       WHERE id = $1 AND user_id = $2;`,
      [id, userId]
    );

    return res.rowCount !== null && res.rowCount > 0;
  }

  private mapRowToPushSubscription(row: any): PushSubscription {
    const props: PushSubscriptionProps = {
      id: row.id,
      userId: row.user_id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      userAgent: row.user_agent || null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };

    return new PushSubscription(props);
  }
}
