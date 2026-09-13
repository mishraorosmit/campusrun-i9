import { Pool, PoolClient } from 'pg';
import { dbPool } from './pool';
import { ITransactionManager, ITransactionContext, IQueryResult } from '../../repositories/ITransactionManager';
import { normalizeDatabaseError } from './errors';

export class TransactionManager implements ITransactionManager {
  public async runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    const pool = dbPool.getPool();
    const client: PoolClient = await pool.connect();

    try {
      await client.query('BEGIN;');
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5000';");

      const txContext: ITransactionContext = {
        query: async <R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<IQueryResult<R>> => {
          try {
            const res = await client.query<any>(text, params);
            return {
              rows: res.rows as R[],
              rowCount: res.rowCount,
            };
          } catch (err) {
            throw normalizeDatabaseError(err);
          }
        },
      };

      const result = await work(txContext);

      await client.query('COMMIT;');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK;');
      } catch (rollbackErr) {
        console.error('[TransactionManager] Rollback failed:', rollbackErr);
      }
      throw normalizeDatabaseError(err);
    } finally {
      client.release();
    }
  }
}

export const transactionManager = new TransactionManager();

export class InMemoryTransactionManager implements ITransactionManager {
  public async runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T> {
    const dummyTx: ITransactionContext = {
      query: async <R = Record<string, unknown>>() => ({ rows: [] as R[], rowCount: 1 }),
    };
    return work(dummyTx);
  }
}

