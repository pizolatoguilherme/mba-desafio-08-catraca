import { afterAll } from 'vitest';
import { pool } from '../src/db.js';

// Cada arquivo de teste tem o próprio módulo db (isolamento do vitest): fecha o pool ao final.
afterAll(async () => {
  await pool.end();
});
