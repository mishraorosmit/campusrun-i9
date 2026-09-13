import { IAnalyticsRepository, AnalyticsRecord } from '../../../repositories/IAnalyticsRepository';
import { dbPool } from '../../database/pool';

export class PostgresAnalyticsRepository implements IAnalyticsRepository {
  constructor(private readonly pool: any = dbPool.getPool()) {}

  public async record(event: AnalyticsRecord): Promise<void> {
    const isUuid = (val?: string | null) =>
      Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));

    const userId = isUuid(event.userId) ? event.userId : null;
    const properties = JSON.stringify(event.properties || {});
    const createdAt = event.createdAt || new Date();

    if (isUuid(event.id)) {
      await this.pool.query(
        `INSERT INTO analytics_events (id, user_id, event_name, properties, created_at)
         VALUES ($1, $2, $3, $4, $5);`,
        [event.id, userId, event.eventName, properties, createdAt]
      );
    } else {
      await this.pool.query(
        `INSERT INTO analytics_events (user_id, event_name, properties, created_at)
         VALUES ($1, $2, $3, $4);`,
        [userId, event.eventName, properties, createdAt]
      );
    }
  }

  public async findRecent(limit = 100): Promise<AnalyticsRecord[]> {
    const res = await this.pool.query(
      `SELECT id, user_id, event_name, properties, created_at
       FROM analytics_events
       ORDER BY created_at DESC
       LIMIT $1;`,
      [limit]
    );

    return res.rows.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      eventName: row.event_name,
      properties: row.properties,
      createdAt: new Date(row.created_at),
    }));
  }
}
