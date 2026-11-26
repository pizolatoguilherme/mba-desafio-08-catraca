import { withTransaction, type Db } from '../db.js';
import type { GatewayResult, PaymentGateway } from './simulated.js';

/**
 * Grava o pedido de pagamento (state 'requested') com o Db do chamador, normalmente a transação
 * da compra: ticket e pagamento são gravados juntos e um rollback desfaz os dois (R06).
 * Não chama o gateway nem kick(): o kick só pode acontecer depois do commit, pelo chamador.
 */
export async function enqueuePayment(c: Db, ticketId: string, cardLast4: string): Promise<void> {
  if (typeof cardLast4 !== 'string' || !/^[0-9]{4}$/.test(cardLast4)) {
    throw new TypeError('cardLast4 deve ter 4 dígitos');
  }
  await c.query('INSERT INTO payments (ticket_id, card_last4) VALUES ($1, $2)', [ticketId, cardLast4]);
}

/**
 * Aplica a resposta do gateway ao ticket (R08), com guarda (R11): só um ticket 'pending' de evento
 * não cancelado muda. O FOR SHARE no evento conflita com o FOR UPDATE do cancelamento (F08), então
 * as duas operações são serializadas; a ordem de lock é evento -> ticket, igual à da compra.
 * O pagamento termina 'done' mesmo quando a guarda recusa, para não ser reprocessado.
 * Retorna true só se o ticket foi alterado.
 */
export async function applyGatewayResult(ticketId: string, result: GatewayResult): Promise<boolean> {
  return withTransaction(async (c) => {
    const ev = await c.query<{ status: string }>(
      `SELECT e.status FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.id = $1 FOR SHARE OF e`,
      [ticketId],
    );
    if (ev.rowCount === 0) return false;

    let changed = false;
    if (ev.rows[0].status !== 'cancelled') {
      const upd = await c.query(
        `UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`,
        [ticketId, result === 'approved' ? 'confirmed' : 'declined'],
      );
      changed = upd.rowCount === 1;
    }
    await c.query(`UPDATE payments SET state = 'done', result = $2, completed_at = now() WHERE ticket_id = $1`, [
      ticketId,
      result,
    ]);
    return changed;
  });
}

export interface Dispatcher {
  start(): void;
  stop(): Promise<void>;
  kick(): void;
  idle(): Promise<void>;
}

export function createDispatcher(opts: { gateway: PaymentGateway; pollMs: number }): Dispatcher {
  void opts;
  return {
    start() {},
    async stop() {},
    kick() {},
    async idle() {},
  };
}
