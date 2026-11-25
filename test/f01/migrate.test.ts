import { describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { runMigrations } from '../../src/migrate.js';

describe('C-F01-12 migrate', () => {
  it('runMigrations é idempotente e registra 001_init uma vez', async () => {
    // o globalSetup já aplicou as migrações: nada pendente, inclusive em execuções concorrentes
    expect(await runMigrations()).toEqual([]);
    expect(await Promise.all([runMigrations(), runMigrations()])).toEqual([[], []]);

    const versions = await query<{ version: string; n: number }>(
      `SELECT version, count(*)::int AS n FROM schema_migrations GROUP BY version ORDER BY version`,
    );
    expect(versions.rows).toContainEqual({ version: '001_init', n: 1 });
    expect(versions.rows.every((r) => r.n === 1)).toBe(true);

    const tables = await query<{ t: string }>(
      `SELECT string_agg(table_name, ',' ORDER BY table_name) AS t
         FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.rows[0].t).toBe('events,payments,schema_migrations,sessions,tickets,users');
  });
});
