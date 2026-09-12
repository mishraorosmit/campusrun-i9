import { Coordinates } from '../../domain/types';

export interface DatabaseConfig {
  connectionString: string;
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
}

export interface IQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

export interface ITransactionContext {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<IQueryResult<T>>;
}

export interface ITransactionManager {
  runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T>;
}

export interface PostgisStatus {
  isAvailable: boolean;
  isInstalled: boolean;
  version?: string;
  details?: string;
}

export interface DatabaseHealthStatus {
  ok: boolean;
  timestamp: string;
  database: string;
  postgis: PostgisStatus;
}
