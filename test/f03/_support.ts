// Helpers locais dos testes de F03 (não altera test/helpers.ts, que F02 também edita).
import type pg from 'pg';
import { query } from '../../src/db.js';
import type { TicketStatus } from '../../src/format.js';

export type PaymentState = 'requested' | 'in_flight' | 'done';

export interface PaymentRow {
  id: string;
  ticket_id: string;
  card_last4: string;
  state: PaymentState;
  result: 'approved' | 'declined' | null;
  requested_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

/** Insere a linha de payments por SQL direto (sem enqueuePayment). `in_flight` preenche started_at. */
export async function insertPayment(ticketId: string, last4: string, state: PaymentState = 'requested'): Promise<void> {
  await query(
    `INSERT INTO payments (ticket_id, card_last4, state, started_at)
     VALUES ($1, $2, $3::text, CASE WHEN $3::text = 'in_flight' THEN now() END)`,
    [ticketId, last4, state],
  );
}

export async function getPayment(ticketId: string): Promise<PaymentRow | null> {
  const r = await query<PaymentRow>('SELECT * FROM payments WHERE ticket_id = $1', [ticketId]);
  return r.rows[0] ?? null;
}

export async function getTicketStatus(id: string): Promise<TicketStatus | null> {
  const r = await query<{ status: TicketStatus }>('SELECT status FROM tickets WHERE id = $1', [id]);
  return r.rows[0]?.status ?? null;
}

/**
 * Fixture de cancelamento (mesmo SQL de architecture.md §5/F08), no client/transação recebido:
 * FOR UPDATE no evento, evento -> cancelled, confirmed -> refunded, pending -> cancelled.
 */
export async function cancelEventFixture(c: pg.PoolClient, eventId: string): Promise<void> {
  await c.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
  await c.query(`UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`, [eventId]);
  await c.query(
    `UPDATE tickets SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled' END,
                        updated_at = now()
      WHERE event_id = $1 AND status IN ('confirmed', 'pending')`,
    [eventId],
  );
}

/** Repete `fn` até devolver truthy ou estourar o prazo (lança). Sem sleep fixo para sincronizar. */
export async function waitFor<T>(fn: () => Promise<T>, timeoutMs: number, stepMs = 20): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`waitFor: prazo de ${timeoutMs} ms estourado`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** Espera `ms` (só para afirmar que algo NÃO aconteceu num intervalo). */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
