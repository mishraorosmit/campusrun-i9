import { Coordinates } from '../../domain/types';

export interface DatabaseConfig {
  connectionString: string;
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
}

export type { IQueryResult, ITransactionContext, ITransactionManager } from '../../repositories/ITransactionManager';

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
