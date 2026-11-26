import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool, query } from '../../src/db.js';
import { createDispatcher, enqueuePayment, type Dispatcher } from '../../src/gateway/dispatcher.js';
import { SimulatedGateway } from '../../src/gateway/simulated.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { waitFor } from './_support.js';

let d: Dispatcher | null = null;

describe('F03 latência e concorrência', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(async () => {
    if (d) await d.stop();
    d = null;
  });

  it(
    '5 pagamentos 0001 confirmados em até 5 s, 10 rodadas em escala 1',
    async () => {
      const org = await createUser({ role: 'organizer' });
      // Escala 1 e polling de 250 ms, SEM kick(): pior caso de latência do dispatcher.
      d = createDispatcher({ gateway: new SimulatedGateway({ scale: 1 }), pollMs: 250 });
      d.start();

      for (let round = 1; round <= 10; round++) {
        const ev = await createEvent({ organizerId: org.id, capacity: 5 });
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) ids.push((await insertTicket({ eventId: ev.id })).id);

        const t0 = performance.now();
        await Promise.all(ids.map((id) => enqueuePayment(pool, id, '0001')));
        await waitFor(async () => {
          const r = await query<{ n: number }>(
            `SELECT count(*)::int AS n FROM tickets WHERE id = ANY($1) AND status = 'confirmed'`,
            [ids],
          );
          return r.rows[0].n === 5;
        }, 6000, 10);
        const elapsed = performance.now() - t0;
        expect(elapsed, `rodada ${round}: ${Math.round(elapsed)} ms`).toBeLessThanOrEqual(5000);

        const p = await query<{ pickup_ms: number; done: boolean }>(
          `SELECT extract(epoch FROM started_at - requested_at) * 1000 AS pickup_ms, state = 'done' AS done
             FROM payments WHERE ticket_id = ANY($1)`,
          [ids],
        );
        expect(p.rowCount).toBe(5);
        for (const row of p.rows) {
          expect(row.done).toBe(true);
          expect(Number(row.pickup_ms), `rodada ${round}: coleta`).toBeLessThanOrEqual(300);
        }

        // Em série, 5 × 2–3 s levariam ≥ 10 s: a janela de processamento prova a concorrência.
        const w = await query<{ window_ms: number }>(
          `SELECT extract(epoch FROM max(completed_at) - min(started_at)) * 1000 AS window_ms
             FROM payments WHERE ticket_id = ANY($1)`,
          [ids],
        );
        expect(Number(w.rows[0].window_ms), `rodada ${round}: janela`).toBeLessThanOrEqual(4300);
      }
    },
    120_000,
  );
});
