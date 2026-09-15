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
