import { pathToFileURL } from 'node:url';
import { hashPassword } from './auth/password.js';
import { pool, type Db } from './db.js';
import { newId } from './ids.js';

/** Contas da seed (as de organizador só existem por aqui: R13). Documentadas no README. */
export const SEED_USERS: ReadonlyArray<{
  role: 'organizer' | 'participant';
  name: string;
  email: string;
  password: string;
}> = [
  { role: 'organizer', name: 'Organizadora A', email: 'org.a@catraca.dev', password: 'catraca123' },
  { role: 'organizer', name: 'Organizador B', email: 'org.b@catraca.dev', password: 'catraca123' },
  { role: 'participant', name: 'Participante Seed', email: 'participante@catraca.dev', password: 'catraca123' },
];

/** Upsert por lower(email): reexecutável, sempre deixa os 3 usuários da seed com a senha documentada. */
export async function runSeed(db: Db = pool): Promise<void> {
  for (const u of SEED_USERS) {
    const hash = await hashPassword(u.password);
    await db.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ((lower(email))) DO UPDATE
         SET name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash`,
      [newId('usr'), u.name, u.email, hash, u.role],
    );
  }
}

// Execução direta: node dist/seed.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeed()
    .then(() => {
      console.log(`seed: ${SEED_USERS.length} usuários garantidos`);
    })
    .catch((err: unknown) => {
      console.error('seed falhou:', (err as Error).message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
