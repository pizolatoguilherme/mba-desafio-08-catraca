import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';

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
});
