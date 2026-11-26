import type { FastifyPluginAsync } from 'fastify';
import { requireParticipant } from '../auth/guards.js';
import { getPublicEvent } from '../events/repo.js';
import { renderEventPage, renderNotFound } from '../events/routes-public.js';
import { statusLabel } from '../format.js';
import { listTicketsForUser, purchaseTicket } from './service.js';

export const INVALID_CARD_MESSAGE = 'Número do cartão inválido: informe os 16 dígitos.';

type PurchaseBody = { cardNumber?: unknown } | undefined;

/** Compra pela vitrine (POST /events/:id/purchase), redirect do GET e "Meus ingressos" (F05). */
export const purchasesPlugin: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string }; Body: PurchaseBody }>(
    '/events/:id/purchase',
    { preHandler: requireParticipant },
    async (req, reply) => {
      const user = req.user!;
      // Evento fora de venda -> 404 sem dados do evento, antes de olhar o cartão (spec §8.3).
      const event = await getPublicEvent(req.params.id);
      if (!event) return renderNotFound(reply);

      const cardNumber = req.body && typeof req.body === 'object' ? req.body.cardNumber : undefined;
      const result = await purchaseTicket({
        eventId: event.id,
        channel: 'web',
        userId: user.id,
        buyerEmail: user.email,
        cardNumber: cardNumber as string,
      });
      if (result.ok) return reply.redirect('/me/tickets', 303);
      switch (result.error) {
        case 'invalid_request':
          return renderEventPage(reply, event, { purchaseError: INVALID_CARD_MESSAGE }, 422);
        case 'sold_out':
          return renderEventPage(reply, event, { soldOut: true }, 409);
        default:
          return renderNotFound(reply);
      }
    },
  );

  // Destino do ?next= do login depois de um POST de visitante: volta para a página do evento.
  app.get<{ Params: { id: string } }>('/events/:id/purchase', async (req, reply) =>
    reply.redirect(`/events/${encodeURIComponent(req.params.id)}`, 303),
  );

  app.get('/me/tickets', { preHandler: requireParticipant }, async (req, reply) => {
    const rows = await listTicketsForUser(req.user!.id);
    const tickets = rows.map((t) => ({
      id: t.id,
      code: t.code,
      status: t.status,
      label: statusLabel(t.status),
      event_name: t.event_name,
    }));
    return reply.view('purchases/my-tickets.ejs', { tickets });
  });
};
