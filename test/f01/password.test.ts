import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/auth/password.js';

describe('C-F01-17 password', () => {
  it('hashPassword gera scrypt$salt$hash com salt aleatório', async () => {
    const a = await hashPassword('catraca123');
    const b = await hashPassword('catraca123');
    expect(a).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(b).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(a).not.toBe(b);
    expect(a.split('$')[1]).not.toBe(b.split('$')[1]);
    // o salt entra no scrypt como bytes brutos (N=16384, r=8, p=1, keylen 64)
    for (const h of [a, b]) {
      const [, salt, hash] = h.split('$');
      const key = scryptSync('catraca123', Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
      expect(key.toString('hex')).toBe(hash);
      const wrong = scryptSync('outra-senha', Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
      expect(wrong.toString('hex')).not.toBe(hash);
    }
  });
});
