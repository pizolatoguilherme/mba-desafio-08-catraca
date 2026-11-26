import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { requireOrganizer } from '../auth/guards.js';
import { renderManagePage } from './manage-sections.js';
import {
  createOwnedEvent,
  getOwnedEvent,
  listOwnedEvents,
  publishOwnedEvent,
  updateOwnedEvent,
  type EventRow,
} from './repo.js';
import { renderNotFound } from './routes-public.js';
import {
  capacityBelowOccupiedMessage,
  EMPTY_FORM_VALUES,
  formValues,
  validateEventInput,
  viewHelpers,
} from './validation.js';

export const STATE_MESSAGES = {
  editCancelled: 'Evento cancelado não pode ser editado.',
  publishCancelled: 'Evento cancelado não pode ser publicado.',
  alreadyPublished: 'O evento já está publicado.',
} as const;

type IdRequest = FastifyRequest<{ Params: { id: string } }>;

function formBody(req: FastifyRequest): Record<string, unknown> {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

/** O guard (requireOrganizer) já garantiu req.user de organizador. */
function organizerId(req: FastifyRequest): string {
  return req.user!.id;
}

/** Re-lê o evento do dono para renderizar o estado atual; se sumiu, 404. */
async function renderCurrent(
  reply: FastifyReply,
  orgId: string,
  id: string,
  status: number,
  extra: Record<string, unknown>,
): Promise<unknown> {
  const event: EventRow | null = await getOwnedEvent(orgId, id);
  if (!event) return renderNotFound(reply);
  reply.code(status);
  return renderManagePage(reply, event, orgId, extra);
}

/** Área do organizador: /org/events, criação, gestão, edição e publicação (R01–R04, R13). */
export const eventsOrgRoutes: FastifyPluginAsync = async (app) => {
  const guard = { preHandler: requireOrganizer };

  app.get('/org/events', guard, async (req, reply) => {
    const events = await listOwnedEvents(organizerId(req));
    return reply.view('org/list.ejs', { ...viewHelpers, events });
  });

  app.get('/org/events/new', guard, async (_req, reply) => {
    return reply.view('org/new.ejs', { values: EMPTY_FORM_VALUES, errors: {} });
  });

  app.post('/org/events/new', guard, async (req, reply) => {
    const form = formBody(req);
    const r = validateEventInput(form);
    if (!r.ok) return reply.code(422).view('org/new.ejs', { values: formValues(form), errors: r.errors });
    const event = await createOwnedEvent(organizerId(req), r.value);
    return reply.redirect(`/org/events/${event.id}`, 303);
  });

  app.get('/org/events/:id', guard, async (req: IdRequest, reply) => {
    const orgId = organizerId(req);
    const event = await getOwnedEvent(orgId, req.params.id);
    if (!event) return renderNotFound(reply);
    return renderManagePage(reply, event, orgId);
  });

  // Edição (D4): dono -> cancelado (409) -> validação (422) -> sob lockEvent: dono, status e lotação × ocupadas.
  app.post('/org/events/:id', guard, async (req: IdRequest, reply) => {
    const orgId = organizerId(req);
    const id = req.params.id;
    const event = await getOwnedEvent(orgId, id);
    if (!event) return renderNotFound(reply);
    if (event.status === 'cancelled') {
      reply.code(409);
      return renderManagePage(reply, event, orgId, { flashError: STATE_MESSAGES.editCancelled });
    }
    const form = formBody(req);
    const values = formValues(form);
    const v = validateEventInput(form);
    if (!v.ok) {
      reply.code(422);
      return renderManagePage(reply, event, orgId, { values, errors: v.errors });
    }
    const r = await updateOwnedEvent(orgId, id, v.value);
    if (r.ok) return reply.redirect(`/org/events/${id}`, 303);
    if (r.error === 'not_found') return renderNotFound(reply);
    if (r.error === 'cancelled') return renderCurrent(reply, orgId, id, 409, { flashError: STATE_MESSAGES.editCancelled });
    return renderCurrent(reply, orgId, id, 422, {
      values,
      errors: { capacity: capacityBelowOccupiedMessage(r.occupied ?? 0) },
    });
  });

  app.post('/org/events/:id/publish', guard, async (req: IdRequest, reply) => {
    const orgId = organizerId(req);
    const id = req.params.id;
    const r = await publishOwnedEvent(orgId, id);
    if (r.ok) return reply.redirect(`/org/events/${id}`, 303);
    if (r.error === 'not_found') return renderNotFound(reply);
    const flashError = r.error === 'cancelled' ? STATE_MESSAGES.publishCancelled : STATE_MESSAGES.alreadyPublished;
    return renderCurrent(reply, orgId, id, 409, { flashError });
  });
};
