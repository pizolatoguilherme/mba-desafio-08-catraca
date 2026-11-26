// F08: rota de cancelamento (POST /org/events/:id/cancel).
import type { FastifyPluginAsync } from 'fastify';
import { requireOrganizer } from '../auth/guards.js';
import { renderManagePage } from '../events/manage-sections.js';
import { getOwnedEvent } from '../events/repo.js';
import { renderNotFound } from '../events/routes-public.js';
import { cancelEvent } from './service.js';

/** Mensagem de rejeição (texto livre de F08, spec §7). */
export const CANCEL_MESSAGES = {
  notCancellable: 'Só é possível cancelar um evento publicado.',
} as const;

/**
 * POST /org/events/:id/cancel (R11, R13):
 *   ok              -> 303 /org/events/:id
 *   not_found       -> 404 genérico (inexistente ou de outro dono)
 *   not_cancellable -> 409 com a página de gestão e data-cancel-error, sem alterar nada
 * Participante -> 403 e visitante -> 302 /login (requireOrganizer).
 */
export const cancelPlugin: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>('/org/events/:id/cancel', { preHandler: requireOrganizer }, async (req, reply) => {
    const orgId = req.user!.id;
    const id = req.params.id;
    const r = await cancelEvent(orgId, id);
    if (r.ok) return reply.redirect(`/org/events/${id}`, 303);
    if (r.error === 'not_found') return renderNotFound(reply);
    const event = await getOwnedEvent(orgId, id);
    if (!event) return renderNotFound(reply);
    reply.code(409);
    return renderManagePage(reply, event, orgId, { cancelError: CANCEL_MESSAGES.notCancellable });
  });
};
