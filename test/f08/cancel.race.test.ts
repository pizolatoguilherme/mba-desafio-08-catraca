import { beforeEach, describe, expect, it } from 'vitest';
import { cancelEvent } from '../../src/cancel/service.js';
import { query } from '../../src/db.js';
import { applyGatewayResult } from '../../src/gateway/dispatcher.js';
import type { GatewayResult } from '../../src/gateway/simulated.js';
import { purchaseTicket } from '../../src/purchases/service.js';
import { createEvent, resetDb } from '../helpers.js';
import { CARD_0001, ORG_A, sleep, userIdByEmail } from './support.js';

const ROUNDS = 20;
const TICKETS = 20;

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const jitter = (): Promise<void> => sleep(Math.floor(Math.random() * 6));

describe('F08 corrida entre cancelamento e respostas do gateway', () => {
  let orgA: string;

  beforeEach(async () => {
    await resetDb();
    orgA = await userIdByEmail(ORG_A);
  });

  it('C-F08-08 AC-F08-02 cancelamento em paralelo com 20 applyGatewayResult, 20 rodadas', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const ev = await createEvent({ organizerId: orgA, capacity: 40, name: `Corrida ${round}` });
      const ids: string[] = [];
      for (let i = 0; i < TICKETS; i++) {
        // buildApp não é chamado: o dispatcher singleton está parado e os pagamentos ficam 'requested'.
        const r = await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: `r${round}-${i}@example.com`, cardNumber: CARD_0001 });
        if (!r.ok) throw new Error(`compra recusada: ${r.error}`);
        ids.push(r.ticket.id);
      }

      const results = new Map<string, GatewayResult>(ids.map((id) => [id, Math.random() < 0.5 ? 'approved' : 'declined']));
      const applied = new Map<string, boolean>();
      let cancelResult: unknown = null;

      const tasks: Array<() => Promise<void>> = [
        async () => {
          await jitter();
          cancelResult = await cancelEvent(orgA, ev.id);
        },
        ...ids.map((id) => async () => {
          await jitter();
          applied.set(id, await applyGatewayResult(id, results.get(id)!));
        }),
      ];
      // Sem exceção (deadlock seria um erro 40P01 do Postgres).
      await Promise.all(shuffle(tasks).map((t) => t()));

      expect(cancelResult).toEqual({ ok: true });
      const e = await query<{ status: string }>('SELECT status FROM events WHERE id = $1', [ev.id]);
      expect(e.rows[0].status).toBe('cancelled');

      const rows = await query<{ id: string; status: string }>('SELECT id, status FROM tickets WHERE event_id = $1', [ev.id]);
      const count = (s: string): number => rows.rows.filter((r) => r.status === s).length;
      expect(count('confirmed')).toBe(0);
      expect(count('pending')).toBe(0);
      expect(count('refunded') + count('cancelled') + count('declined')).toBe(TICKETS);

      // Cada ticket recebeu uma resposta: aplicada antes do lock do cancelamento (true; aprovado -> refunded,
      // recusado -> declined) ou depois dele (false; ticket já 'cancelled', resposta ignorada).
      for (const r of rows.rows) {
        const ok = applied.get(r.id);
        if (r.status === 'cancelled') expect(ok).toBe(false);
        else if (r.status === 'refunded') expect({ ok, result: results.get(r.id) }).toEqual({ ok: true, result: 'approved' });
        else expect({ ok, result: results.get(r.id) }).toEqual({ ok: true, result: 'declined' });
      }

      // Todo pagamento termina 'done', inclusive os ignorados.
      const p = await query<{ n: number }>(
        "SELECT count(*)::int AS n FROM payments p JOIN tickets t ON t.id = p.ticket_id WHERE t.event_id = $1 AND p.state = 'done'",
        [ev.id],
      );
      expect(p.rows[0].n).toBe(TICKETS);
    }
  }, 120_000);
});
