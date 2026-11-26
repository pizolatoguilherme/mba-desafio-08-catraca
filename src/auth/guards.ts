import type { FastifyReply, FastifyRequest } from 'fastify';

function redirectToLogin(req: FastifyRequest, reply: FastifyReply): void {
  reply.redirect(`/login?next=${encodeURIComponent(req.url)}`, 302);
}

/**
 * Renderiza o 403 ANTES de enviar (D4): quando a promise do guard resolve, a resposta já foi
 * enviada e o Fastify não executa o handler protegido.
 */
async function forbid(reply: FastifyReply, message: string): Promise<void> {
  const html = await reply.viewAsync('error.ejs', { status: 403, title: 'Acesso negado', message });
  reply.code(403).type('text/html; charset=utf-8').send(html);
}

/** Sem usuário -> 302 /login?next=<url>; usuário que não é organizador -> 403. */
export async function requireOrganizer(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (reply.sent) return;
  if (!req.user) return redirectToLogin(req, reply);
  if (req.user.role !== 'organizer') await forbid(reply, 'Esta área é restrita a organizadores.');
}

/** Sem usuário -> 302 /login?next=<url>; organizador -> 403. */
export async function requireParticipant(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (reply.sent) return;
  if (!req.user) return redirectToLogin(req, reply);
  if (req.user.role !== 'participant') await forbid(reply, 'Esta área é restrita a participantes.');
}
