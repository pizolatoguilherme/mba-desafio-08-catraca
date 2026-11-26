import { beforeEach, describe, expect, it } from 'vitest';
import { pool, query, withTransaction } from '../../src/db.js';
import type { TicketStatus } from '../../src/format.js';
import { applyGatewayResult } from '../../src/gateway/dispatcher.js';
import type { GatewayResult } from '../../src/gateway/simulated.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { cancelEventFixture, delay, getPayment, getTicketStatus, insertPayment } from './_support.js';

let organizerId: string;

async function ticketWithPayment(eventId: string, status: TicketStatus = 'pending', last4 = '0001'): Promise<string> {
  const t = await insertTicket({ eventId, status });
  await insertPayment(t.id, last4, 'in_flight');
  return t.id;
}

async function ticketUpdatedAt(id: string): Promise<string> {
  const r = await query<{ u: string }>(`SELECT updated_at::text AS u FROM tickets WHERE id = $1`, [id]);
  return r.rows[0].u;
}

describe('F03 applyGatewayResult', () => {
  beforeEach(async () => {
    await resetDb();
    organizerId = (await createUser({ role: 'organizer' })).id;
  });

  it('applyGatewayResult confirma ou recusa ticket pending e fecha o pagamento', async () => {
    const ev = await createEvent({ organizerId });
    const cases: Array<[GatewayResult, TicketStatus]> = [
      ['approved', 'confirmed'],
      ['declined', 'declined'],
    ];
    for (const [result, expected] of cases) {
      const id = await ticketWithPayment(ev.id);
      expect(await applyGatewayResult(id, result)).toBe(true);
      expect(await getTicketStatus(id)).toBe(expected);
      const p = await getPayment(id);
      expect(p?.state).toBe('done');
      expect(p?.result).toBe(result);
      expect(p?.completed_at).toBeInstanceOf(Date);
    }
    // ticket inexistente: false, nada muda
    expect(await applyGatewayResult('tkt_inexistente', 'approved')).toBe(false);
  });

  it('applyGatewayResult não altera ticket que não está pending', async () => {
    const ev = await createEvent({ organizerId });
    const statuses: TicketStatus[] = ['confirmed', 'declined', 'cancelled', 'refunded'];
    for (const status of statuses) {
      for (const result of ['approved', 'declined'] as GatewayResult[]) {
        const id = await ticketWithPayment(ev.id, status);
        const before = await ticketUpdatedAt(id);
        await delay(5);
        expect(await applyGatewayResult(id, result), `${status}/${result}`).toBe(false);
        expect(await getTicketStatus(id)).toBe(status);
        expect(await ticketUpdatedAt(id)).toBe(before);
        const p = await getPayment(id);
        expect(p?.state).toBe('done');
        expect(p?.result).toBe(result);
      }
    }
  });

  it('applyGatewayResult não confirma ticket de evento cancelado', async () => {
    const ev = await createEvent({ organizerId, status: 'cancelled' });
    const id = await ticketWithPayment(ev.id, 'pending');
    expect(await applyGatewayResult(id, 'approved')).toBe(false);
    expect(await getTicketStatus(id)).toBe('pending');
    const p = await getPayment(id);
    expect(p?.state).toBe('done');
    expect(p?.result).toBe('approved');
  });

  it('applyGatewayResult espera o lock do evento e respeita o cancelamento', async () => {
    const ev = await createEvent({ organizerId });
    const id = await ticketWithPayment(ev.id);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [ev.id]);

      let settled = false;
      const applying = applyGatewayResult(id, 'approved').finally(() => {
        settled = true;
      });
      await delay(500);
      expect(settled).toBe(false);

      await cancelEventFixture(c, ev.id);
      await c.query('COMMIT');

      expect(await applying).toBe(false);
      expect(await getTicketStatus(id)).toBe('cancelled');
    } finally {
      c.release();
    }
  });

  it('corrida: cancelamento contra 20 respostas simultâneas nunca deixa confirmed', async () => {
    for (let round = 0; round < 20; round++) {
      const ev = await createEvent({ organizerId, capacity: 20 });
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) ids.push(await ticketWithPayment(ev.id));

      const applies = ids.map((id) => applyGatewayResult(id, 'approved'));
      const cancel = withTransaction((c) => cancelEventFixture(c, ev.id));
      const [results] = await Promise.all([Promise.all(applies), cancel]);

      const evRow = await query<{ status: string }>('SELECT status FROM events WHERE id = $1', [ev.id]);
      expect(evRow.rows[0].status).toBe('cancelled');
      const counts = await query<{ status: TicketStatus; n: number }>(
        'SELECT status, count(*)::int AS n FROM tickets WHERE event_id = $1 GROUP BY status',
        [ev.id],
      );
      const by: Record<string, number> = {};
      for (const r of counts.rows) by[r.status] = r.n;
      expect(by.confirmed ?? 0, `rodada ${round}`).toBe(0);
      expect((by.refunded ?? 0) + (by.cancelled ?? 0)).toBe(20);
      expect(results.filter(Boolean).length).toBe(by.refunded ?? 0);
    }
  });
});
