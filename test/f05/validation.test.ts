import { describe, expect, it } from 'vitest';
import { validatePurchaseInput } from '../../src/purchases/service.js';

const EMAIL = 'ana@example.com';
const CARD = '4000000000000001';

describe('F05 validação da entrada de compra', () => {
  it('C-F05-02 validatePurchaseInput aceita só e-mail bem formado e cartão string de 16 dígitos', () => {
    expect(validatePurchaseInput({ buyerEmail: EMAIL, cardNumber: CARD })).toEqual({ ok: true });
    expect(validatePurchaseInput({ buyerEmail: 'carga7@example.com', cardNumber: '4000000000000004' })).toEqual({ ok: true });

    const invalid: Array<[string, unknown, unknown]> = [
      ['cartão 123', EMAIL, '123'],
      ['cartão com 15 dígitos', EMAIL, '400000000000001'],
      ['cartão com 17 dígitos', EMAIL, '40000000000000001'],
      ['cartão com letras', EMAIL, '40000000000000ab'],
      ['cartão com espaços', EMAIL, '4000 0000 0000 0001'],
      ['cartão com espaço nas pontas', EMAIL, ' 4000000000000001'],
      ['cartão null', EMAIL, null],
      ['cartão ausente', EMAIL, undefined],
      ['cartão número', EMAIL, 4000000000000001],
      ['cartão array', EMAIL, [CARD]],
      ['cartão objeto', EMAIL, { n: CARD }],
      ['e-mail sem @', 'ana.example.com', CARD],
      ['e-mail sem domínio', 'ana@', CARD],
      ['e-mail sem ponto no domínio', 'ana@example', CARD],
      ['e-mail com espaço', 'ana silva@example.com', CARD],
      ['e-mail ausente', undefined, CARD],
      ['e-mail null', null, CARD],
      ['e-mail número', 123, CARD],
      ['e-mail array', [EMAIL], CARD],
      ['e-mail com mais de 254 caracteres', `${'a'.repeat(243)}@example.com`, CARD],
    ];
    for (const [label, buyerEmail, cardNumber] of invalid) {
      expect(validatePurchaseInput({ buyerEmail, cardNumber }), label).toEqual({ ok: false, error: 'invalid_request' });
    }
    // Limite: exatamente 254 caracteres ainda é aceito.
    const e254 = `${'a'.repeat(242)}@example.com`;
    expect(e254).toHaveLength(254);
    expect(validatePurchaseInput({ buyerEmail: e254, cardNumber: CARD })).toEqual({ ok: true });
  });
});
