import { describe, expect, it } from 'vitest';
import { CHECKIN_MESSAGES } from '../../src/checkin/service.js';

describe('F07 checkIn', () => {
  it('C-F07-02 CHECKIN_MESSAGES tem as 5 mensagens literais do brief', () => {
    expect(CHECKIN_MESSAGES).toStrictEqual({
      invalid: 'Ingresso inválido para este evento',
      cancelled: 'Evento cancelado',
      notConfirmed: 'Ingresso não confirmado',
      used: 'Ingresso já utilizado',
      ok: 'Entrada liberada',
    });
  });
});
