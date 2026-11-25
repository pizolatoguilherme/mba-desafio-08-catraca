import pg from 'pg';
import { config } from './config.js';

export type Db = pg.Pool | pg.PoolClient;

export const pool: pg.Pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 50,
});

// Um client ocioso que perde a conexão emite 'error' no pool; sem handler, o processo cairia.
pool.on('error', (err) => {
  console.error('[db] erro em conexão ociosa do pool:', err.message);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function query<T extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
  return pool.query<T>(sql, params);
}

export async function withTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      broken = rollbackErr as Error;
    }
    throw err;
  } finally {
    // Se o ROLLBACK falhou, a conexão está em estado incerto: descarta em vez de devolver ao pool.
    client.release(broken);
  }
}
