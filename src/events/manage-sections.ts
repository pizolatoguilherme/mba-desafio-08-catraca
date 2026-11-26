import type { FastifyReply } from 'fastify';
import { pool } from '../db.js';
import { formatBRL } from '../format.js';
import { getSeatCounts, type EventRow } from './repo.js';
import { eventStatusLabel, eventToFormValues, formatEventDateTime, viewHelpers } from './validation.js';

export type ManageSection = (ctx: { event: EventRow; organizerId: string }) => Promise<Record<string, unknown>>;

// Map preserva a ordem de inserção; registrar o mesmo nome de novo substitui a função (mantendo a posição).
const sections = new Map<string, ManageSection>();

/** Registra uma seção da página de gestão (F07 registra 'panel'). O retorno é mesclado nos locals. */
export function registerManageSection(name: string, fn: ManageSection): void {
  sections.set(name, fn);
}

/**
 * Locals da página de gestão: { event, seats, statusLabel, startsAtLabel, priceLabel, canEdit,
 * canPublish, values, errors: {}, flashError: null } + o retorno de cada seção registrada,
 * na ordem de registro, mesclado de forma rasa (Object.assign).
 */
export async function buildManageLocals(event: EventRow, organizerId: string): Promise<Record<string, unknown>> {
  const locals: Record<string, unknown> = {
    event,
    seats: await getSeatCounts(pool, event.id),
    statusLabel: eventStatusLabel(event.status),
    startsAtLabel: formatEventDateTime(event.starts_at),
    priceLabel: formatBRL(event.price_cents),
    canEdit: event.status !== 'cancelled',
    canPublish: event.status === 'draft',
    values: eventToFormValues(event),
    errors: {},
    flashError: null,
  };
  for (const fn of sections.values()) {
    Object.assign(locals, await fn({ event, organizerId }));
  }
  return locals;
}

/**
 * reply.view('org/manage.ejs', { ...buildManageLocals, user, ...extra }). O status HTTP é o que o
 * chamador definiu antes (reply.code(…)); default 200. extra.values/errors/flashError sobrepõem os defaults.
 */
export async function renderManagePage(
  reply: FastifyReply,
  event: EventRow,
  organizerId: string,
  extra?: Record<string, unknown>,
): Promise<unknown> {
  const locals = await buildManageLocals(event, organizerId);
  return reply.view('org/manage.ejs', { ...viewHelpers, ...locals, user: reply.request.user, ...extra });
}
