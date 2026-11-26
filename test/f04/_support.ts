// Helpers locais dos testes de F04 (não altera test/helpers.ts).
import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { query } from '../../src/db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** POST application/x-www-form-urlencoded com o cookie de sessão (ou nenhum). */
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
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    payload: body.toString(),
  });
}

/** GET com o cookie de sessão (ou nenhum). */
export async function getPage(app: FastifyInstance, url: string, cookie: string | null = null): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
}

/** Valor de <input type="datetime-local"> daqui a `days` dias, às 20:00 (hora de America/Sao_Paulo). */
export function futureLocal(days = 30): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10) + 'T20:00';
}

/** Valor de <input type="datetime-local"> de ontem, às 20:00. */
export function pastLocal(): string {
  return new Date(Date.now() - DAY_MS).toISOString().slice(0, 10) + 'T20:00';
}

/** Trecho do HTML do evento: da linha com data-event-id até o fechamento `</tag>`. */
export function block(html: string, eventId: string, tag = 'li'): string {
  const start = html.indexOf(`data-event-id="${eventId}"`);
  if (start < 0) return '';
  const end = html.indexOf(`</${tag}>`, start);
  return html.slice(start, end < 0 ? undefined : end + tag.length + 3);
}

/** Linha do HTML (do bloco do evento) que contém data-field="<name>", ou '' se não houver. */
export function field(html: string, eventId: string | null, name: string, tag = 'li'): string {
  const scope = eventId ? block(html, eventId, tag) : html;
  return scope.split('\n').find((l) => l.includes(`data-field="${name}"`))?.trim() ?? '';
}

/** Linha do HTML que contém o atributo indicado (ex.: 'data-error="capacity"'), ou ''. */
export function line(html: string, attr: string): string {
  return html.split('\n').find((l) => l.includes(attr))?.trim() ?? '';
}

/** Dados de formulário de evento válidos, com sobrescritas. */
export function eventForm(over: Partial<Record<'name' | 'venue' | 'startsAt' | 'capacity' | 'price', string>> = {}): Record<string, string> {
  return {
    name: 'Jazz no Porão',
    venue: 'Bar do Porão',
    startsAt: futureLocal(30),
    capacity: '2',
    price: '100,00',
    ...over,
  };
}

export async function userId(email: string): Promise<string> {
  const r = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  return r.rows[0].id;
}

export const ORG_A = 'org.a@catraca.dev';
export const ORG_B = 'org.b@catraca.dev';
export const PARTICIPANT = 'participante@catraca.dev';
export const SEED_PASSWORD = 'catraca123';

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resolve com 'pending' se a promise não terminar em `ms`, senão com o resultado. */
export async function settlesWithin<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  const timeout = sleep(ms).then(() => ({ done: false as const }));
  return Promise.race([p.then((value) => ({ done: true as const, value })), timeout]);
}
