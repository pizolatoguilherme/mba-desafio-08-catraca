// Prova de R07: as vagas ocupadas nunca passam da lotação, nem com compras simultâneas (spec §8.1, §12.2).
import { beforeEach, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../../src/db.js';
import { getSeatCounts, lockEvent } from '../../src/events/repo.js';
import { newId, newTicketCode } from '../../src/ids.js';
import { purchaseTicket, type PurchaseResult } from '../../src/purchases/service.js';
import { createEvent, createUser, resetDb } from '../helpers.js';
import { CARD_0001, settlesWithin, sleep } from './_support.js';

const ROUNDS = 20;
const BURST = 30;
const CAPACITY = 5;

const OCCUPIED_SQL = "SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')";

/** Amostra as ocupadas do evento numa conexão dedicada, a cada ~2 ms, até stop(). Devolve o máximo visto. */
function startSampler(eventId: string): { stop: () => Promise<{ max: number; samples: number }> } {
  let running = true;
  const done = (async () => {
    const c = await pool.connect();
    let max = 0;
    let samples = 0;
    try {
      while (running) {
        const r = await c.query<{ n: number }>(OCCUPIED_SQL, [eventId]);
        max = Math.max(max, r.rows[0].n);
        samples++;
        await sleep(2);
      }
      // Uma última amostra depois do fim da rajada.
      const r = await c.query<{ n: number }>(OCCUPIED_SQL, [eventId]);
      max = Math.max(max, r.rows[0].n);
      samples++;
    } finally {
      c.release();
    }
    return { max, samples };
  })();
  return {
    stop: async () => {
      running = false;
      return done;
    },
  };
}

/** Implementação ingênua (o defeito da primeira tentativa): conta, espera, insere, sem lockEvent. */
async function naivePurchase(eventId: string, i: number): Promise<boolean> {
  return withTransaction(async (c) => {
    const r = await c.query<{ available: number }>(
      `SELECT e.capacity - (SELECT count(*) FROM tickets t WHERE t.event_id = e.id AND t.status IN ('pending', 'confirmed'))::int AS available
         FROM events e WHERE e.id = $1`,
      [eventId],
    );
    await c.query('SELECT pg_sleep(0.05)');
    if (r.rows[0].available <= 0) return false;
    await c.query(
      `INSERT INTO tickets (id, event_id, buyer_email, channel, code, price_cents, card_last4)
       VALUES ($1, $2, $3, 'partner', $4, 1000, '0001')`,
      [newId('tkt'), eventId, `ingenuo${i}@example.com`, newTicketCode()],
    );
    return true;
  });
}

describe('F05 prova de lotação sob concorrência (R07)', () => {
  let org: string;
  let buyer: { id: string; email: string };

  beforeEach(async () => {
    await resetDb();
    org = (await createUser({ role: 'organizer' })).id;
    buyer = await createUser({ role: 'participant' });
  });

  it(`C-F05-09 R07: 30 compras simultâneas × 20 rodadas, lotação 5, ocupadas nunca passam de 5`, async () => {
    // Com menos conexões que promessas, o próprio pool serializaria as compras e o teste não provaria nada.
    expect(pool.options.max).toBeGreaterThanOrEqual(BURST + 1);

    for (let round = 1; round <= ROUNDS; round++) {
      const { id: eventId } = await createEvent({ organizerId: org, capacity: CAPACITY, priceCents: 1000, name: `Rajada ${round}` });
      const sampler = startSampler(eventId);

      const results: PurchaseResult[] = await Promise.all(
        Array.from({ length: BURST }, (_, i) =>
          purchaseTicket(
            i % 2 === 0
              ? { eventId, channel: 'web', userId: buyer.id, buyerEmail: buyer.email, cardNumber: CARD_0001 }
              : { eventId, channel: 'partner', buyerEmail: `carga${round}-${i}@example.com`, cardNumber: CARD_0001 },
          ),
        ),
      );
      const { max, samples } = await sampler.stop();

      const ok = results.filter((r) => r.ok);
      const soldOut = results.filter((r) => !r.ok && r.error === 'sold_out');
      expect(ok, `rodada ${round}: sucessos`).toHaveLength(CAPACITY);
      expect(soldOut, `rodada ${round}: sold_out`).toHaveLength(BURST - CAPACITY);
      expect(samples, `rodada ${round}: amostras`).toBeGreaterThan(0);
      expect(max, `rodada ${round}: máximo de ocupadas amostrado`).toBeLessThanOrEqual(CAPACITY);

      expect(await getSeatCounts(pool, eventId)).toEqual({ capacity: CAPACITY, occupied: CAPACITY, available: 0 });
      const tickets = await pool.query<{ code: string }>('SELECT code FROM tickets WHERE event_id = $1', [eventId]);
      expect(tickets.rowCount, `rodada ${round}: tickets`).toBe(CAPACITY);
      expect(new Set(tickets.rows.map((t) => t.code)).size, `rodada ${round}: códigos distintos`).toBe(CAPACITY);
      const payments = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM payments p JOIN tickets t ON t.id = p.ticket_id WHERE t.event_id = $1',
        [eventId],
      );
      expect(payments.rows[0].n, `rodada ${round}: payments`).toBe(CAPACITY);
      const okIds = new Set(ok.map((r) => (r.ok ? r.ticket.id : '')));
      expect(okIds.size).toBe(CAPACITY);
    }
  });

  it('C-F05-10 controle: check-then-insert sem lock vende além da lotação', async () => {
    const { id: eventId } = await createEvent({ organizerId: org, capacity: CAPACITY, priceCents: 1000 });
    const results = await Promise.all(Array.from({ length: BURST }, (_, i) => naivePurchase(eventId, i)));
    const { occupied } = await getSeatCounts(pool, eventId);
    expect(results.filter(Boolean).length).toBe(occupied);
    expect(occupied).toBeGreaterThan(CAPACITY);
  });

  it('C-F05-11 purchaseTicket espera o lockEvent de outra transação', async () => {
    const { id: eventId } = await createEvent({ organizerId: org, capacity: CAPACITY });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      expect((await lockEvent(c, eventId))?.id).toBe(eventId);

      const purchase = purchaseTicket({ eventId, channel: 'partner', buyerEmail: 'espera@example.com', cardNumber: CARD_0001 });
      const early = await settlesWithin(purchase, 300);
      expect(early.done).toBe(false);

      await c.query('COMMIT');
      const r = await purchase;
      expect(r.ok).toBe(true);
    } finally {
      c.release();
    }
  });
});
