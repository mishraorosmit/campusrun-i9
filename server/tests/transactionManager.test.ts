import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TransactionManager } from '../infrastructure/database/transaction';
import { dbPool } from '../infrastructure/database/pool';

describe('TransactionManager Transaction Behavior', () => {
  it('should execute BEGIN, work queries, and COMMIT on successful transaction', async () => {
    const executedStatements: string[] = [];
    let released = false;

    const mockClient = {
      query: async (text: string) => {
        executedStatements.push(text);
        return { rows: [], rowCount: 1 };
      },
      release: () => {
        released = true;
      },
    };

    // Temporarily stub pool.connect
    const originalGetPool = dbPool.getPool.bind(dbPool);
    (dbPool as any).getPool = () => ({
      connect: async () => mockClient,
    });

    try {
      const txManager = new TransactionManager();
      const result = await txManager.runInTransaction(async (tx) => {
        await tx.query('INSERT INTO test_table VALUES ($1)', ['value1']);
        return 'success_payload';
      });

      assert.equal(result, 'success_payload');
      assert.equal(executedStatements[0], 'BEGIN;');
      assert(executedStatements.some((stmt) => stmt.includes('INSERT INTO test_table')));
      assert.equal(executedStatements[executedStatements.length - 1], 'COMMIT;');
      assert.equal(released, true, 'Client must be released to pool');
    } finally {
      (dbPool as any).getPool = originalGetPool;
    }
  });

  it('should execute ROLLBACK and release client when an error occurs', async () => {
    const executedStatements: string[] = [];
    let released = false;

    const mockClient = {
      query: async (text: string) => {
        executedStatements.push(text);
        return { rows: [], rowCount: 1 };
      },
      release: () => {
        released = true;
      },
    };

    const originalGetPool = dbPool.getPool.bind(dbPool);
    (dbPool as any).getPool = () => ({
      connect: async () => mockClient,
    });

    try {
      const txManager = new TransactionManager();
      await assert.rejects(
        async () => {
          await txManager.runInTransaction(async (tx) => {
            await tx.query('UPDATE test_table SET val = 1');
            throw new Error('Simulated failure during transaction');
          });
        },
        (err: any) => {
          assert.equal(err.name, 'InternalServerError');
          return true;
        }
      );

      assert.equal(executedStatements[0], 'BEGIN;');
      assert(executedStatements.includes('ROLLBACK;'), 'ROLLBACK must be executed on error');
      assert.equal(released, true, 'Client must be released to pool after error');
    } finally {
      (dbPool as any).getPool = originalGetPool;
    }
  });
});
