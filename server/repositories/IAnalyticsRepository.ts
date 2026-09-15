export interface AnalyticsRecord {
  id?: string;
  userId?: string | null;
  eventName: string;
  properties?: Record<string, any>;
  createdAt?: Date;
}

export interface IAnalyticsRepository {
  record(event: AnalyticsRecord): Promise<void>;
  findRecent?(limit?: number): Promise<AnalyticsRecord[]>;
}
