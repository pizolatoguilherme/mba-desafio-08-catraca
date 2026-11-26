// Helpers locais dos testes de F08 (não altera test/helpers.ts).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { config } from '../../src/config.js';
import { query } from '../../src/db.js';
import { createDispatcher, type Dispatcher } from '../../src/gateway/dispatcher.js';
import { SimulatedGateway } from '../../src/gateway/simulated.js';

export const ORG_A = 'org.a@catraca.dev';
export const ORG_B = 'org.b@catraca.dev';
export const PARTICIPANT = 'participante@catraca.dev';
export const SEED_PASSWORD = 'catraca123';
export const CARD_0001 = '4000000000000001';
export const CARD_0003 = '4000000000000003';

export const METRICS = ['confirmed', 'pending', 'checkins', 'available', 'revenue', 'refunded'] as const;
export type Metric = (typeof METRICS)[number];

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Dispatcher local, já iniciado. O singleton do app fica parado (buildApp({ startDispatcher: false })). */
export function startTestDispatcher(scale: number, pollMs = 20): Dispatcher {
  const d = createDispatcher({ gateway: new SimulatedGateway({ scale }), pollMs });
  d.start();
  return d;
}

/** Espera `fn()` devolver true (polling a cada `stepMs`) ou lança após `timeoutMs`. */
export async function waitFor(fn: () => Promise<boolean>, timeoutMs: number, stepMs = 20): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > until) throw new Error(`waitFor: tempo esgotado (${timeoutMs} ms)`);
    await sleep(stepMs);
  }
}

/** Requisição à API de parceiros via app.inject, com X-Api-Key (default: a chave do config) e corpo JSON. */
export function apiInject(
  app: FastifyInstance,
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
  key: string | null = config.partnerApiKey,
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {};
  if (key !== null) headers['x-api-key'] = key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.inject({
    method,
    url,
    headers,
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

export async function postForm(
  app: FastifyInstance,
  url: string,
  cookie: string | null,
  fields: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
}

export async function getPage(app: FastifyInstance, url: string, cookie: string | null = null): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
}

export async function userIdByEmail(email: string): Promise<string> {
  const r = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  return r.rows[0].id;
}

export async function ticketStatus(ticketId: string): Promise<string> {
  const r = await query<{ status: string }>('SELECT status FROM tickets WHERE id = $1', [ticketId]);
  return r.rows[0].status;
}

export async function eventStatus(eventId: string): Promise<string> {
  const r = await query<{ status: string }>('SELECT status FROM events WHERE id = $1', [eventId]);
  return r.rows[0].status;
}

/** Snapshot das linhas de events e tickets (para provar "sem efeito"). */
export async function snapshot(): Promise<{ events: unknown[]; tickets: unknown[] }> {
  const events = await query('SELECT * FROM events ORDER BY id');
  const tickets = await query('SELECT * FROM tickets ORDER BY id');
  return { events: events.rows, tickets: tickets.rows };
}

/** Os 6 números do painel, com a mesma regex dos contratos: data-metric="x"[^>]*>([^<]*)< */
export function panelMetrics(html: string): Record<Metric, string | null> {
  const out = {} as Record<Metric, string | null>;
  for (const k of METRICS) {
    const m = html.match(new RegExp(`data-metric="${k}"[^>]*>([^<]*)<`));
    out[k] = m ? m[1].trim() : null;
  }
  return out;
}

/** Texto de <p data-checkin-result…>…</p>, ou null. */
export function checkinResult(html: string): string | null {
  const m = html.match(/data-checkin-result[^>]*>([^<]*)</);
  return m ? m[1].trim() : null;
}

/** Formulário de edição de F04 (POST /org/events/:id). */
export function editForm(p: { name: string; capacity: string; price: string }): Record<string, string> {
  const startsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) + 'T20:00';
  return { name: p.name, venue: 'Bar do Teste', startsAt, capacity: p.capacity, price: p.price };
}
