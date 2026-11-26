// Helpers locais dos testes de F05 (não altera test/helpers.ts).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { query } from '../../src/db.js';
import type { TicketStatus } from '../../src/format.js';

export const PARTICIPANT = 'participante@catraca.dev';
export const ORG_A = 'org.a@catraca.dev';
export const SEED_PASSWORD = 'catraca123';
export const CARD_0001 = '4000000000000001';
export const CARD_0002 = '4000000000000002';
export const CARD_0003 = '4000000000000003';

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** { done: false } se a promise não terminar em `ms`, senão { done: true, value }. */
export async function settlesWithin<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  const timeout = sleep(ms).then(() => ({ done: false as const }));
  return Promise.race([p.then((value) => ({ done: true as const, value })), timeout]);
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

export async function postForm(
  app: FastifyInstance,
  url: string,
  cookie: string | null,
  fields: Record<string, string | string[]> = {},
): Promise<LightMyRequestResponse> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) body.append(k, item);
  }
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    payload: body.toString(),
  });
}

export async function getPage(app: FastifyInstance, url: string, cookie: string | null = null): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
}

export async function ticketCount(eventId?: string): Promise<number> {
  const r = eventId
    ? await query<{ n: number }>('SELECT count(*)::int AS n FROM tickets WHERE event_id = $1', [eventId])
    : await query<{ n: number }>('SELECT count(*)::int AS n FROM tickets');
  return r.rows[0].n;
}

export async function ticketStatus(id: string): Promise<TicketStatus | null> {
  const r = await query<{ status: TicketStatus }>('SELECT status FROM tickets WHERE id = $1', [id]);
  return r.rows[0]?.status ?? null;
}

export async function userIdByEmail(email: string): Promise<string> {
  const r = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  return r.rows[0].id;
}

/** Linhas <tr data-ticket-id=…>…</tr> de "Meus ingressos" (uma por linha de HTML). */
export function ticketRows(html: string): string[] {
  return html.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('<tr data-ticket-id='));
}
