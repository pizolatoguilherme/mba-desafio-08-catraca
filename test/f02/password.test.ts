import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { resetDb } from '../helpers.js';

describe('F02 senhas', () => {
  it('verifyPassword aceita a senha correta e recusa a errada', async () => {
    const h = await hashPassword('segredo123');
    expect(await verifyPassword('segredo123', h)).toBe(true);
    expect(await verifyPassword('segredo124', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('verifyPassword recusa hash malformado', async () => {
    const h = await hashPassword('segredo123');
    const [, salt, key] = h.split('$');
    const malformed = [
      '',
      'segredo123',
      'scrypt$',
      `bcrypt$${salt}$${key}`,
      `scrypt$${salt}`,
      `scrypt$${salt}$${key.slice(0, 64)}`,
      `scrypt$${salt.slice(0, 10)}$${key}`,
      `scrypt$${salt}$${key}$extra`,
      `scrypt$${salt.toUpperCase()}$${key}`,
      `scrypt$${'z'.repeat(32)}$${key}`,
    ];
    for (const m of malformed) {
      await expect(verifyPassword('segredo123', m)).resolves.toBe(false);
    }
    await expect(verifyPassword('segredo123', undefined as unknown as string)).resolves.toBe(false);
  });

  it('senha do signup é gravada com scrypt e nunca em texto puro', async () => {
    await resetDb();
    const app = await buildApp({ startDispatcher: false });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/signup',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'name=Cofre&email=cofre%40example.com&password=segredo123',
      });
      expect(res.statusCode).toBe(303);
      const r = await query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'cofre@example.com'");
      const h = r.rows[0].password_hash;
      expect(h).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      expect(h).not.toContain('segredo123');
      expect(await verifyPassword('segredo123', h)).toBe(true);
      // mesma senha, salts diferentes -> hashes diferentes
      const seed = await query<{ n: string }>(
        `SELECT count(DISTINCT password_hash)::text AS n FROM users
          WHERE email IN ('org.a@catraca.dev', 'org.b@catraca.dev', 'participante@catraca.dev')`,
      );
      expect(seed.rows[0].n).toBe('3');
    } finally {
      await app.close();
    }
  });
});
