import { describe, expect, it } from 'vitest';
import { newId, newTicketCode } from '../../src/ids.js';

describe('C-F01-16 ids', () => {
  it('newId gera prefixo e 10 caracteres [a-z0-9]', () => {
    const ids = new Set<string>();
    for (const prefix of ['usr', 'evt', 'tkt'] as const) {
      for (let i = 0; i < 1000; i++) {
        const id = newId(prefix);
        expect(id).toMatch(/^(usr|evt|tkt)_[a-z0-9]{10}$/);
        expect(id.startsWith(`${prefix}_`)).toBe(true);
        ids.add(id);
      }
    }
    expect(ids.size).toBe(3000);
  });

  it('newTicketCode gera 8 caracteres [A-Z2-9] sem 0, 1, O e I', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const code = newTicketCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      codes.add(code);
    }
    // 32^8 combinações: colisões em 10 000 amostras são praticamente impossíveis
    expect(codes.size).toBeGreaterThanOrEqual(9_999);
  });
});
