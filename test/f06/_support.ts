// Helpers locais dos testes de F06 (não altera test/helpers.ts).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { query } from '../../src/db.js';

export const KEY = 'catraca-parceiro-2026';
export const CARD_0001 = '4000000000000001';
export const CARD_0003 = '4000000000000003';
export const CARD_0004 = '4000000000000004';
export const JSON_CT = 'application/json; charset=utf-8';

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Espera `check()` devolver true (polling a cada 10 ms) ou lança após `timeoutMs`. */
export async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > until) throw new Error('waitFor: tempo esgotado');
    await sleep(10);
  }
}

export function apiGet(app: FastifyInstance, url: string, key: string | null = KEY): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url, headers: key === null ? {} : { 'x-api-key': key } });
}

/** POST de compra com corpo JSON (objeto é serializado; string vai como está). */
export function apiBuy(
  app: FastifyInstance,
  eventId: string,
  body: unknown,
  opts: { key?: string | null; contentType?: string | null } = {},
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {};
  const key = opts.key === undefined ? KEY : opts.key;
  if (key !== null) headers['x-api-key'] = key;
  const ct = opts.contentType === undefined ? 'application/json' : opts.contentType;
  if (ct !== null) headers['content-type'] = ct;
  return app.inject({
    method: 'POST',
    url: `/api/partner/events/${eventId}/purchases`,
    headers,
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export function validBody(email = 'parceiro@example.com', cardNumber = CARD_0001): { buyerEmail: string; cardNumber: string } {
  return { buyerEmail: email, cardNumber };
}

/** Status, Content-Type JSON e corpo exatamente igual (inclusive a ordem das chaves). */
export function expectJson(res: LightMyRequestResponse, status: number, body: unknown): void {
  expect({ status: res.statusCode, body: res.body }).toEqual({ status, body: JSON.stringify(body) });
  expect(res.headers['content-type']).toBe(JSON_CT);
}

export async function ticketCount(eventId?: string): Promise<number> {
  const r = eventId
    ? await query<{ n: number }>('SELECT count(*)::int AS n FROM tickets WHERE event_id = $1', [eventId])
    : await query<{ n: number }>('SELECT count(*)::int AS n FROM tickets');
  return r.rows[0].n;
}
