import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { pool } from '../db.js';
import { getPublicEvent, getSeatCounts, listOnSaleEvents, type EventRow } from './repo.js';
import { viewHelpers } from './validation.js';

/** Mesma página genérica que o core (F01) gera para rota inexistente, sem dado nenhum do evento. */
export async function renderNotFound(reply: FastifyReply): Promise<unknown> {
  return reply.code(404).view('error.ejs', {
    status: 404,
    title: 'Página não encontrada',
    message: 'O endereço acessado não existe ou não está disponível.',
  });
}

/**
 * Renderiza events/show.ejs com { event, seats, user, ...extra }. O status HTTP é statusCode (se
 * informado) ou o que o chamador definiu antes com reply.code(…). F05 usa para re-renderizar com 409/422.
 */
export async function renderEventPage(
  reply: FastifyReply,
  event: EventRow,
  extra?: Record<string, unknown>,
  statusCode?: number,
): Promise<unknown> {
  if (statusCode !== undefined) reply.code(statusCode);
  const seats = await getSeatCounts(pool, event.id);
  return reply.view('events/show.ejs', { ...viewHelpers, event, seats, user: reply.request.user, ...extra });
}

/** GET / (vitrine) e GET /events/:id (página pública, só published). */
export const eventsPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (_req, reply) => {
    const events = await listOnSaleEvents();
    return reply.view('events/showcase.ejs', { ...viewHelpers, events });
  });

  app.get<{ Params: { id: string } }>('/events/:id', async (req, reply) => {
    const event = await getPublicEvent(req.params.id);
    if (!event) return renderNotFound(reply);
    return renderEventPage(reply, event);
  });
};
