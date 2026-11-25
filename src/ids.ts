import { randomInt } from 'node:crypto';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
// Sem 0, 1, O e I, para o código ser fácil de ler e digitar na portaria.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** prefix + '_' + 10 caracteres [a-z0-9]. Ex.: evt_k3j9x0a1bq */
export function newId(prefix: 'usr' | 'evt' | 'tkt'): string {
  return `${prefix}_${randomString(ID_ALPHABET, 10)}`;
}

/** 8 caracteres do alfabeto ABCDEFGHJKLMNPQRSTUVWXYZ23456789. */
export function newTicketCode(): string {
  return randomString(CODE_ALPHABET, 8);
}
