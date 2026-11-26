// F07: rota de check-in e seção 'panel' da página de gestão.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireOrganizer } from '../auth/guards.js';
import { pool } from '../db.js';
import { registerManageSection, renderManagePage } from '../events/manage-sections.js';
import { getOwnedEvent } from '../events/repo.js';
import { renderNotFound } from '../events/routes-public.js';
import { formatBRL } from '../format.js';
import { getPanel } from './panel.js';
import { CHECKIN_MESSAGES, checkIn } from './service.js';

function codeField(req: FastifyRequest): string {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return '';
  const code = (b as Record<string, unknown>).code;
  return typeof code === 'string' ? code : '';
}

export const checkinPlugin: FastifyPluginAsync = async (app) => {
  // Painel (R12) calculado a cada renderização da página de gestão, sem cache (D6).
  registerManageSection('panel', async ({ event }) => {
    const p = await getPanel(pool, event.id);
    return { panel: { ...p, revenue: formatBRL(p.revenueCents) } };
  });

  // R10 / R13: só o dono do evento; outro organizador ou evento inexistente -> 404, sem chamar checkIn (D10).
  app.post<{ Params: { id: string } }>('/org/events/:id/checkin', { preHandler: requireOrganizer }, async (req, reply) => {
    const orgId = req.user!.id;
    const event = await getOwnedEvent(orgId, req.params.id);
    if (!event) return renderNotFound(reply);
    const key = await checkIn(event.id, codeField(req));
    // D7: 200 com a página de gestão re-renderizada (o painel já vem com o check-in aplicado).
    return renderManagePage(reply, event, orgId, { checkinResult: CHECKIN_MESSAGES[key], checkinResultKey: key });
  });
};
