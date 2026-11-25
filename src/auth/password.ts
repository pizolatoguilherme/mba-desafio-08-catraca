import { randomBytes, scrypt, type ScryptOptions } from 'node:crypto';

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
