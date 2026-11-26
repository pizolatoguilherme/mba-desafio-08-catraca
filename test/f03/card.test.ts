import { describe, expect, it } from 'vitest';
import { cardLast4, isValidCardNumber } from '../../src/gateway/card.js';

describe('F03 card', () => {
  it('isValidCardNumber aceita exatamente 16 dígitos', () => {
    expect(isValidCardNumber('4000000000000001')).toBe(true);
    expect(isValidCardNumber('0000000000000000')).toBe(true);
    expect(isValidCardNumber('9999999999999999')).toBe(true);
  });

  it('isValidCardNumber rejeita entradas inválidas', () => {
    const invalid: unknown[] = [
      '',
      '400000000000001',
      '40000000000000011',
      '400000000000000a',
      '4000 0000 0000 0001',
      ' 4000000000000001',
      '4000000000000001 ',
      '4000000000000001\n',
      '４００００００００００００００１',
      '٤٠٠٠٠٠٠٠٠٠٠٠٠٠٠١',
      null,
      undefined,
      4000000000000001,
      {},
      [],
      ['4000000000000001'],
    ];
    for (const v of invalid) expect(isValidCardNumber(v), String(v)).toBe(false);
  });

  it('cardLast4 devolve os 4 últimos dígitos', () => {
    expect(cardLast4('4000000000000001')).toBe('0001');
    expect(cardLast4('1234567812345678')).toBe('5678');
  });
});
