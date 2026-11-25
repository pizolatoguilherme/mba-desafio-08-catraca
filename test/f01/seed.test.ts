import { scryptSync, timingSafeEqual } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { runSeed, SEED_USERS } from '../../src/seed.js';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  password_hash: string;
}

async function users(): Promise<UserRow[]> {
  const r = await query<UserRow>('SELECT id, name, email, role, password_hash FROM users ORDER BY email');
  return r.rows;
}

describe('C-F01-12 seed', () => {
  beforeEach(async () => {
    await query('TRUNCATE users, sessions, events, tickets, payments RESTART IDENTITY CASCADE');
  });

  it('runSeed cria 2 organizadores e 1 participante', async () => {
    await runSeed();
    const rows = await users();
    expect(rows.map((u) => `${u.email} ${u.role} ${u.name}`)).toEqual([
      'org.a@catraca.dev organizer Organizadora A',
      'org.b@catraca.dev organizer Organizador B',
      'participante@catraca.dev participant Participante Seed',
    ]);
    expect(rows.every((u) => /^usr_[a-z0-9]{10}$/.test(u.id))).toBe(true);
    expect(await query('SELECT 1 FROM events')).toMatchObject({ rowCount: 0 });
  });

  it('runSeed é idempotente (3 execuções)', async () => {
    await runSeed();
    const first = await users();
    await runSeed();
    await runSeed();
    const third = await users();
    expect(third).toHaveLength(3);
    expect(third.map((u) => u.id)).toEqual(first.map((u) => u.id));
    const roles = await query<{ role: string; n: number }>(
      'SELECT role, count(*)::int AS n FROM users GROUP BY role ORDER BY role',
    );
    expect(roles.rows).toEqual([
      { role: 'organizer', n: 2 },
      { role: 'participant', n: 1 },
    ]);
  });

  it('senhas da seed ficam com hash scrypt', async () => {
    // um usuário com o e-mail em outra caixa é atualizado, não duplicado
    await query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ('usr_seedold00', 'Antigo', 'ORG.A@catraca.dev', 'invalido', 'participant')`,
    );
    await runSeed();
    const rows = await users();
    expect(rows).toHaveLength(3);
    for (const u of rows) {
      expect(u.password_hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      const seed = SEED_USERS.find((s) => s.email === u.email.toLowerCase());
      expect(seed).toBeDefined();
      const [, salt, hash] = u.password_hash.split('$');
      const key = scryptSync(seed!.password, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
      expect(timingSafeEqual(key, Buffer.from(hash, 'hex'))).toBe(true);
    }
    const orgA = rows.find((u) => u.id === 'usr_seedold00');
    expect(orgA?.role).toBe('organizer');
  });
});
