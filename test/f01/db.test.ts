import { afterEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { pool, query, withTransaction } from '../../src/db.js';

const EMAILS = ['tx-commit@example.com', 'tx-rollback@example.com'];

async function cleanup(): Promise<void> {
  await query('DELETE FROM users WHERE email = ANY($1)', [EMAILS]);
}

async function insertUser(c: pg.PoolClient, id: string, email: string): Promise<void> {
  await c.query(
    `INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, 'Tx', $2, 'x', 'participant')`,
    [id, email],
  );
}

describe('C-F01-18 db', () => {
  afterEach(cleanup);

  it('withTransaction faz COMMIT quando a função resolve', async () => {
    await cleanup();
    const result = await withTransaction(async (c) => {
      await insertUser(c, 'usr_txcommit0', EMAILS[0]);
      // dentro da transação, outra conexão ainda não enxerga a linha
      const outside = await query('SELECT 1 FROM users WHERE id = $1', ['usr_txcommit0']);
      expect(outside.rowCount).toBe(0);
      return 'ok';
    });
    expect(result).toBe('ok');
    const after = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', ['usr_txcommit0']);
    expect(after.rows).toEqual([{ email: EMAILS[0] }]);
  });

  it('withTransaction faz ROLLBACK quando a função lança', async () => {
    await cleanup();
    const before = pool.totalCount - pool.idleCount;
    await expect(
      withTransaction(async (c) => {
        await insertUser(c, 'usr_txrollbk0', EMAILS[1]);
        throw new Error('falha proposital');
      }),
    ).rejects.toThrow('falha proposital');
    const after = await query('SELECT 1 FROM users WHERE id = $1', ['usr_txrollbk0']);
    expect(after.rowCount).toBe(0);
    // o client foi devolvido ao pool
    expect(pool.totalCount - pool.idleCount).toBe(before);
  });

  it('pool aceita até 50 conexões', async () => {
    expect(pool.options.max).toBe(50);
    const clients = await Promise.all(Array.from({ length: 50 }, () => pool.connect()));
    try {
      expect(pool.totalCount).toBe(50);
      const rows = await Promise.all(clients.map((c) => c.query<{ one: number }>('SELECT 1 AS one')));
      expect(rows.every((r) => r.rows[0].one === 1)).toBe(true);
    } finally {
      clients.forEach((c) => c.release());
    }
  });
});
