import { beforeEach, describe, expect, it } from 'vitest';
import { cancelEvent } from '../../src/cancel/service.js';
import { query } from '../../src/db.js';
import { createEvent, insertTicket, resetDb } from '../helpers.js';
import { ORG_A, ORG_B, snapshot, ticketStatus, userIdByEmail } from './support.js';

describe('F08 cancelEvent', () => {
  let orgA: string;
  let orgB: string;

  beforeEach(async () => {
    await resetDb();
    orgA = await userIdByEmail(ORG_A);
    orgB = await userIdByEmail(ORG_B);
  });

  it('C-F08-05 transições de R11 confirmed para refunded e pending para cancelled, imediatas', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 10 });
    const c1 = await insertTicket({ eventId: ev.id, status: 'confirmed', checkedIn: true });
    const c2 = await insertTicket({ eventId: ev.id, status: 'confirmed' });
    const p1 = await insertTicket({ eventId: ev.id, status: 'pending', channel: 'partner' });
    const d1 = await insertTicket({ eventId: ev.id, status: 'declined' });
    const r1 = await insertTicket({ eventId: ev.id, status: 'refunded' });
    // Ingresso de outro evento: não muda.
    const other = await createEvent({ organizerId: orgA });
    const o1 = await insertTicket({ eventId: other.id, status: 'confirmed' });
    const before = await query<{ id: string; checked_in_at: Date | null; updated_at: Date }>(
      'SELECT id, checked_in_at, updated_at FROM tickets WHERE id = ANY($1)',
      [[c1.id, d1.id, r1.id]],
    );
    const byId = new Map(before.rows.map((r) => [r.id, r]));

    expect(await cancelEvent(orgA, ev.id)).toEqual({ ok: true });

    // Sem espera: o efeito é imediato (mesma transação).
    const e = await query<{ status: string; cancelled_at: Date | null }>('SELECT status, cancelled_at FROM events WHERE id = $1', [ev.id]);
    expect(e.rows[0].status).toBe('cancelled');
    expect(e.rows[0].cancelled_at).not.toBeNull();
    expect(await ticketStatus(c1.id)).toBe('refunded');
    expect(await ticketStatus(c2.id)).toBe('refunded');
    expect(await ticketStatus(p1.id)).toBe('cancelled');
    expect(await ticketStatus(d1.id)).toBe('declined');
    expect(await ticketStatus(r1.id)).toBe('refunded');
    expect(await ticketStatus(o1.id)).toBe('confirmed');

    const after = await query<{ id: string; checked_in_at: Date | null; updated_at: Date }>(
      'SELECT id, checked_in_at, updated_at FROM tickets WHERE id = ANY($1)',
      [[c1.id, d1.id, r1.id]],
    );
    const a = new Map(after.rows.map((r) => [r.id, r]));
    expect(a.get(c1.id)!.checked_in_at).not.toBeNull();
    expect(a.get(c1.id)!.checked_in_at!.getTime()).toBe(byId.get(c1.id)!.checked_in_at!.getTime());
    // Recusado e estornado: linha intacta (nem updated_at muda).
    expect(a.get(d1.id)!.updated_at.getTime()).toBe(byId.get(d1.id)!.updated_at.getTime());
    expect(a.get(r1.id)!.updated_at.getTime()).toBe(byId.get(r1.id)!.updated_at.getTime());
  });

  it('C-F08-06 só evento publicado do próprio dono pode ser cancelado, sem efeito nos demais casos', async () => {
    const draft = await createEvent({ organizerId: orgA, status: 'draft' });
    const cancelled = await createEvent({ organizerId: orgA, status: 'cancelled' });
    const published = await createEvent({ organizerId: orgA });
    await insertTicket({ eventId: draft.id, status: 'pending' });
    await insertTicket({ eventId: cancelled.id, status: 'refunded' });
    await insertTicket({ eventId: published.id, status: 'confirmed' });
    await insertTicket({ eventId: published.id, status: 'pending' });

    const before = await snapshot();
    expect(await cancelEvent(orgA, draft.id)).toEqual({ ok: false, error: 'not_cancellable' });
    expect(await cancelEvent(orgA, cancelled.id)).toEqual({ ok: false, error: 'not_cancellable' });
    expect(await cancelEvent(orgA, 'evt_naoexiste')).toEqual({ ok: false, error: 'not_found' });
    expect(await cancelEvent(orgB, published.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await cancelEvent(orgB, draft.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await snapshot()).toEqual(before);
  });
});
