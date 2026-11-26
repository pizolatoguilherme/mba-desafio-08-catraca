import type { Db } from '../db.js';
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

export async function applyGatewayResult(ticketId: string, result: GatewayResult): Promise<boolean> {
  void ticketId;
  void result;
  throw new Error('F03: não implementado');
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
