import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

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

const TICKET_PATH = /^\/api\/partner\/tickets\/[^/]+\/?$/;
const PURCHASE_PATH = /^\/api\/partner\/events\/[^/]+\/purchases\/?$/;

/** Rotas da API de parceiros, registradas sob o prefixo /api/partner. */
export const partnerRoutes: FastifyPluginAsync = async (app) => {
  // Antes de qualquer parsing: sem chave válida, nada mais roda (nem o parser de corpo).
  app.addHook('onRequest', async (req, reply) => {
    if (!checkApiKey(req)) return unauthorized(reply);
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

  app.get('/events', async (_req, reply) => reply.code(200).send([]));
  app.post('/events/:eventId/purchases', async (_req, reply) => reply.code(501).send({ error: 'not_implemented' }));
  app.get('/tickets/:ticketId', async (_req, reply) => reply.code(501).send({ error: 'not_implemented' }));
};

/**
 * Plugin encapsulado (SEM fastify-plugin): parser, hooks e handlers valem só em /api/partner/*.
 */
export const partnerPlugin: FastifyPluginAsync = async (app) => {
  await app.register(partnerRoutes, { prefix: '/api/partner' });
};
