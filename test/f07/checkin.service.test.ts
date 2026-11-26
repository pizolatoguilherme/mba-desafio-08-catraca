import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { CHECKIN_MESSAGES, checkIn, normalizeCode } from '../../src/checkin/service.js';
import type { TicketStatus } from '../../src/format.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { checkedInAt, ticketStatus } from './support.js';

describe('F07 checkIn', () => {
  let org: string;

  beforeEach(async () => {
    await resetDb();
    org = (await createUser({ role: 'organizer' })).id;
  });

  it('C-F07-02 CHECKIN_MESSAGES tem as 5 mensagens literais do brief', () => {
    expect(CHECKIN_MESSAGES).toStrictEqual({
      invalid: 'Ingresso inválido para este evento',
      cancelled: 'Evento cancelado',
      notConfirmed: 'Ingresso não confirmado',
      used: 'Ingresso já utilizado',
      ok: 'Entrada liberada',
    });
  });

  it('C-F07-03 código inexistente ou vazio resulta em invalid', async () => {
    const ev = await createEvent({ organizerId: org });
    await insertTicket({ eventId: ev.id, status: 'confirmed' });
    expect(await checkIn(ev.id, 'ZZZZZZZZ')).toBe('invalid');
    expect(await checkIn(ev.id, '')).toBe('invalid');
    expect(await checkIn(ev.id, '   ')).toBe('invalid');
    // Entrada que não é string e evento inexistente também são inválidos.
    expect(await checkIn(ev.id, undefined as unknown as string)).toBe('invalid');
    expect(await checkIn('evt_inexistente', 'ZZZZZZZZ')).toBe('invalid');
    expect(normalizeCode(42)).toBeNull();
  });

  it('C-F07-04 código confirmado de outro evento resulta em invalid', async () => {
    const e1 = await createEvent({ organizerId: org });
    const e2 = await createEvent({ organizerId: org });
    const t2 = await insertTicket({ eventId: e2.id, status: 'confirmed' });
    expect(await checkIn(e1.id, t2.code)).toBe('invalid');
    expect(await checkedInAt(t2.id)).toBeNull();
  });

  it('C-F07-05 R10-1 tem precedência sobre R10-2 em evento cancelado', async () => {
    const cancelled = await createEvent({ organizerId: org, status: 'cancelled' });
    const other = await createEvent({ organizerId: org });
    const tOther = await insertTicket({ eventId: other.id, status: 'confirmed' });
    await insertTicket({ eventId: cancelled.id, status: 'refunded' });
    expect(await checkIn(cancelled.id, 'ZZZZZZZZ')).toBe('invalid');
    expect(await checkIn(cancelled.id, tOther.code)).toBe('invalid');
    expect(await checkedInAt(tOther.id)).toBeNull();
  });

  it('C-F07-06 evento cancelado resulta em cancelled sem gravar check-in', async () => {
    const ev = await createEvent({ organizerId: org, status: 'cancelled' });
    const tickets = [
      await insertTicket({ eventId: ev.id, status: 'refunded' }),
      await insertTicket({ eventId: ev.id, status: 'cancelled' }),
      await insertTicket({ eventId: ev.id, status: 'confirmed' }),
    ];
    for (const t of tickets) {
      expect(await checkIn(ev.id, t.code)).toBe('cancelled');
      expect(await checkedInAt(t.id)).toBeNull();
    }
    const refundedUsed = await insertTicket({ eventId: ev.id, status: 'refunded', checkedIn: true });
    const before = await checkedInAt(refundedUsed.id);
    expect(await checkIn(ev.id, refundedUsed.code)).toBe('cancelled');
    expect(await checkedInAt(refundedUsed.id)).toEqual(before);
  });

  it('C-F07-07 ingresso não confirmado tem precedência sobre já utilizado', async () => {
    const ev = await createEvent({ organizerId: org });
    for (const status of ['pending', 'declined', 'cancelled', 'refunded'] as TicketStatus[]) {
      const t = await insertTicket({ eventId: ev.id, status });
      expect(await checkIn(ev.id, t.code), status).toBe('notConfirmed');
      expect(await checkedInAt(t.id)).toBeNull();
    }
    const declinedUsed = await insertTicket({ eventId: ev.id, status: 'declined', checkedIn: true });
    expect(await checkIn(ev.id, declinedUsed.code)).toBe('notConfirmed');
  });

  it('C-F07-08 confirmado resulta em Entrada liberada uma única vez e grava checked_in_at', async () => {
    const ev = await createEvent({ organizerId: org });
    const t = await insertTicket({ eventId: ev.id, status: 'confirmed' });
    expect(await checkIn(ev.id, t.code)).toBe('ok');
    const first = await checkedInAt(t.id);
    expect(first).not.toBeNull();
    expect(await ticketStatus(t.id)).toBe('confirmed');
    expect(await checkIn(ev.id, t.code)).toBe('used');
    expect(await checkedInAt(t.id)).toEqual(first);
    expect(await ticketStatus(t.id)).toBe('confirmed');
  });

  it('C-F07-09 normaliza espaços nas pontas e caixa do código', async () => {
    const ev = await createEvent({ organizerId: org });
    await insertTicket({ eventId: ev.id, status: 'confirmed', code: 'K7Q2M9XA' });
    expect(normalizeCode('  k7q2m9xa ')).toBe('K7Q2M9XA');
    expect(normalizeCode('K7Q2 M9XA')).toBe('K7Q2 M9XA');
    expect(await checkIn(ev.id, '  k7q2m9xa ')).toBe('ok');
    expect(await checkIn(ev.id, 'K7q2M9xA')).toBe('used');
  });

  it('C-F07-10 10 check-ins simultâneos do mesmo código liberam exatamente 1 entrada em 10 rodadas', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 100 });
    for (let round = 0; round < 10; round++) {
      const t = await insertTicket({ eventId: ev.id, status: 'confirmed' });
      const variants = Array.from({ length: 10 }, (_, i) => {
        const c = i % 2 === 0 ? t.code.toLowerCase() : t.code;
        return ' '.repeat(i % 3) + c + ' '.repeat(i % 2);
      });
      const results = await Promise.all(variants.map((code) => checkIn(ev.id, code)));
      expect(results.filter((r) => r === 'ok'), `rodada ${round}`).toHaveLength(1);
      expect(results.filter((r) => r === 'used'), `rodada ${round}`).toHaveLength(9);
      const r = await query<{ n: number }>(
        'SELECT count(*)::int AS n FROM tickets WHERE id = $1 AND checked_in_at IS NOT NULL',
        [t.id],
      );
      expect(r.rows[0].n).toBe(1);
    }
  });
});
