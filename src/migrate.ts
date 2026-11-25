import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool } from './db.js';

// Resolve a partir de src/*.ts (vitest) e de dist/*.js (produção).
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

// Chave arbitrária e fixa do advisory lock das migrações.
const MIGRATION_LOCK_KEY = 7_201_001;

/**
 * Aplica, em ordem lexicográfica, os arquivos migrations/*.sql ainda não registrados em
 * schema_migrations. Cada arquivo roda numa transação própria. Devolve as versões aplicadas
 * nesta execução ([] se não havia nada pendente).
 */
export async function runMigrations(): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version    text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
      const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
      const done = new Set(rows.map((r) => r.version));
      const applied: string[] = [];
      for (const file of files) {
        const version = file.slice(0, -'.sql'.length);
        if (done.has(version)) continue;
        const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`migração ${file} falhou: ${(err as Error).message}`, { cause: err });
        }
        applied.push(version);
      }
      return applied;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

// Execução direta: node dist/migrate.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations()
    .then((applied) => {
      console.log(applied.length ? `migrações aplicadas: ${applied.join(', ')}` : 'migrações: nada pendente');
    })
    .catch((err: unknown) => {
      console.error((err as Error).message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
