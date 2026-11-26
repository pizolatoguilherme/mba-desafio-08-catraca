import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { type EventRow, listOnSaleEvents } from '../events/repo.js';
import { toIsoWithOffset } from '../format.js';
import { findTicketById, purchaseTicket, type TicketRow, validatePurchaseInput } from '../purchases/service.js';

// API de parceiros (contrato fixo de docs/brief.md). Spec: docs/features/F06-api-parceiros/spec.md.

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/**
 * true só se X-Api-Key é uma string não vazia igual a config.partnerApiKey. A comparação é dos
 * digests sha256 (mesmo tamanho para o timingSafeEqual, sem vazar o tamanho da chave pelo tempo).
 * Cabeçalho ausente, vazio ou repetido (array) -> false.
 */
export function checkApiKey(req: FastifyRequest): boolean {
  const got = req.headers['x-api-key'];
  if (typeof got !== 'string' || got === '') return false;
  return timingSafeEqual(sha256(got), sha256(config.partnerApiKey));
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({ error: 'unauthorized' });
}

function invalidRequest(reply: FastifyReply): FastifyReply {
  return reply.code(422).send({ error: 'invalid_request' });
}

const BODY_LIMIT = 16 * 1024;

export type PurchaseBody = { ok: true; buyerEmail: string; cardNumber: string } | { ok: false };

/**
 * Corpo da compra: media type application/json (charset opcional), corpo string não vazio,
 * JSON válido, objeto simples e validatePurchaseInput ok. Campos extras são ignorados.
 */
export function parsePurchaseBody(req: FastifyRequest): PurchaseBody {
  const ct = req.headers['content-type'];
  const mediaType = typeof ct === 'string' ? ct.split(';')[0].trim().toLowerCase() : '';
  if (mediaType !== 'application/json') return { ok: false };
  const raw: unknown = req.body;
  if (typeof raw !== 'string' || raw === '') return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false };
  const { buyerEmail, cardNumber } = parsed as Record<string, unknown>;
  if (!validatePurchaseInput({ buyerEmail, cardNumber }).ok) return { ok: false };
  return { ok: true, buyerEmail: buyerEmail as string, cardNumber: cardNumber as string };
}

/** Item da listagem, campo a campo (nunca spread de linha do banco). */
export function serializeEvent(e: EventRow & { available: number }): {
  id: string;
  name: string;
  startsAt: string;
  priceCents: number;
  availableSeats: number;
} {
  return {
    id: e.id,
    name: e.name,
    startsAt: toIsoWithOffset(e.starts_at),
    priceCents: Number(e.price_cents),
    availableSeats: Number(e.available),
  };
}

// Formato de newId (architecture.md §5): fora dele, 404 sem tocar no banco.
const EVENT_ID = /^evt_[a-z0-9]{10}$/;
const TICKET_ID = /^tkt_[a-z0-9]{10}$/;

/** Consulta de ingresso, campo a campo; status sem tradução e checkedIn derivado de checked_in_at. */
export function serializeTicket(t: TicketRow): { ticketId: string; code: string; eventId: string; status: string; checkedIn: boolean } {
  return {
    ticketId: t.id,
    code: t.code,
    eventId: t.event_id,
    status: t.status,
    checkedIn: t.checked_in_at !== null,
  };
}

const TICKET_PATH = /^\/api\/partner\/tickets\/[^/]+\/?$/;
const PURCHASE_PATH = /^\/api\/partner\/events\/[^/]+\/purchases\/?$/;

/** Rotas da API de parceiros, registradas sob o prefixo /api/partner. */
export const partnerRoutes: FastifyPluginAsync = async (app) => {
  // Antes de qualquer parsing: sem chave válida, nada mais roda (nem o parser de corpo).
  app.addHook('onRequest', async (req, reply) => {
    if (!checkApiKey(req)) return unauthorized(reply);
  });

  // Qualquer Content-Type (ou nenhum) vira texto: o Fastify nunca responde 415 nem 400 de JSON.
  // A validação (media type, JSON, campos) é do handler.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: BODY_LIMIT }, (_req, body, done) => {
    done(null, body);
  });

  // Erros de cliente do framework (corpo grande demais, FST_ERR_CTP_*, validação) -> 422; resto -> 500 JSON.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const code = err.statusCode ?? 500;
    if (code >= 400 && code < 500) {
      req.log.info({ code: err.code, status: code }, 'api de parceiros: requisição rejeitada');
      return invalidRequest(reply);
    }
    req.log.error({ err }, 'api de parceiros: erro não tratado');
    return reply.code(500).send({ error: 'internal_error' });
  });

  // Rota/método desconhecido: refaz a checagem da chave e responde pela forma do caminho
  // (ids acima de maxParamLength não casam com a rota no roteador).
  app.setNotFoundHandler((req, reply) => {
    if (!checkApiKey(req)) return unauthorized(reply);
    const path = req.url.split('?')[0];
    if ((req.method === 'GET' || req.method === 'HEAD') && TICKET_PATH.test(path)) {
      return reply.code(404).send({ error: 'ticket_not_found' });
    }
    if (req.method === 'POST' && PURCHASE_PATH.test(path)) {
      return reply.code(404).send({ error: 'event_not_available' });
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  app.get('/events', async (_req, reply) => {
    const events = await listOnSaleEvents();
    return reply.code(200).send(events.map(serializeEvent));
  });
  // Ordem de erros: chave (401, no onRequest) -> corpo (422) -> evento (404) -> vaga (409).
  // R07 sob concorrência é garantido pelo lock FOR UPDATE do evento dentro de purchaseTicket.
  app.post<{ Params: { eventId: string } }>('/events/:eventId/purchases', async (req, reply) => {
    const body = parsePurchaseBody(req);
    if (!body.ok) return invalidRequest(reply);
    const { eventId } = req.params;
    if (!EVENT_ID.test(eventId)) return reply.code(404).send({ error: 'event_not_available' });
    const r = await purchaseTicket({
      eventId,
      channel: 'partner',
      userId: null,
      buyerEmail: body.buyerEmail,
      cardNumber: body.cardNumber,
    });
    if (r.ok) return reply.code(202).send({ ticketId: r.ticket.id, code: r.ticket.code, status: 'pending' });
    if (r.error === 'event_not_available') return reply.code(404).send({ error: 'event_not_available' });
    if (r.error === 'sold_out') return reply.code(409).send({ error: 'sold_out' });
    return invalidRequest(reply);
  });
  // Ingressos de qualquer canal (vitrine ou parceiro), por id.
  app.get<{ Params: { ticketId: string } }>('/tickets/:ticketId', async (req, reply) => {
    const { ticketId } = req.params;
    const t = TICKET_ID.test(ticketId) ? await findTicketById(ticketId) : null;
    if (!t) return reply.code(404).send({ error: 'ticket_not_found' });
    return reply.code(200).send(serializeTicket(t));
  });
};

/**
 * Plugin encapsulado (SEM fastify-plugin): parser, hooks e handlers valem só em /api/partner/*.
 */
export const partnerPlugin: FastifyPluginAsync = async (app) => {
  await app.register(partnerRoutes, { prefix: '/api/partner' });
};
