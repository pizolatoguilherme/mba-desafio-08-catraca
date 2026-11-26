import type { Db } from '../db.js';
import type { GatewayResult, PaymentGateway } from './simulated.js';

export async function enqueuePayment(c: Db, ticketId: string, cardLast4: string): Promise<void> {
  void c;
  void ticketId;
  void cardLast4;
  throw new Error('F03: não implementado');
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
