import { IAnalyticsRepository, AnalyticsRecord } from '../../../repositories/IAnalyticsRepository';

export class InMemoryAnalyticsRepository implements IAnalyticsRepository {
  public records: AnalyticsRecord[] = [];

  constructor(initialRecords: AnalyticsRecord[] = []) {
    this.records = [...initialRecords];
  }

  public async record(event: AnalyticsRecord): Promise<void> {
    this.records.push({
      id: event.id || `anl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      userId: event.userId || null,
      eventName: event.eventName,
      properties: event.properties || {},
      createdAt: event.createdAt || new Date(),
    });
  }

  public async findRecent(limit = 100): Promise<AnalyticsRecord[]> {
    return [...this.records]
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
      .slice(0, limit);
  }

  public clear(): void {
    this.records = [];
  }
}
