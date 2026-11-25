import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

// Roda uma vez, antes de todos os arquivos de teste: aplica o schema no banco efêmero do gates.
export default async function setup(): Promise<void> {
  try {
    await runMigrations();
  } finally {
    await pool.end();
  }
}
