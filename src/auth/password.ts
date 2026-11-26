import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Parâmetros fixos (F02 verifica com os mesmos): salt de 16 bytes brutos, keylen 64, N=16384, r=8, p=1.
const SALT_BYTES = 16;
const KEY_LEN = 64;
const SCRYPT_OPTS: ScryptOptions = { N: 16384, r: 8, p: 1 };

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Devolve "scrypt$<salt hex 32>$<hash hex 128>". */
export async function hashPassword(p: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(p, salt, KEY_LEN, SCRYPT_OPTS);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

const HASH_RE = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

/** Recalcula o scrypt com o salt do hash e compara com timingSafeEqual. Hash malformado -> false (nunca lança). */
export async function verifyPassword(p: string, h: string): Promise<boolean> {
  if (typeof p !== 'string' || typeof h !== 'string') return false;
  const m = HASH_RE.exec(h);
  if (!m) return false;
  const salt = Buffer.from(m[1], 'hex');
  const expected = Buffer.from(m[2], 'hex');
  try {
    const key = await scryptAsync(p, salt, KEY_LEN, SCRYPT_OPTS);
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
