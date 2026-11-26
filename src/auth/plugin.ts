import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { query } from '../db.js';
import { requireOrganizer } from './guards.js';
import { authRoutes } from './routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; name: string; email: string; role: 'participant' | 'organizer' } | null;
  }
  interface FastifyReply {
    /** Mesclado pelo @fastify/view nos dados de toda view (inclusive no layout). */
    locals: Record<string, unknown>;
  }
}

export type SessionUser = NonNullable<FastifyRequest['user']>;

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_SECONDS = 604800; // 7 dias

// 32 bytes aleatórios em base64url = 43 caracteres.
const SID_RE = /^[A-Za-z0-9_-]{43}$/;

/** Cria uma sessão nova (7 dias) para o usuário e devolve o id. */
export async function createSession(userId: string): Promise<string> {
  const sid = randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (id, user_id, expires_at, created_at)
     VALUES ($1, $2, now() + make_interval(secs => $3), now())`,
    [sid, userId, SESSION_TTL_SECONDS],
  );
  return sid;
}

/** Apaga a sessão (logout). Id ausente ou desconhecido não é erro. */
export async function destroySession(sid: string): Promise<void> {
  if (!sid) return;
  await query('DELETE FROM sessions WHERE id = $1', [sid]);
}

async function loadSessionUser(sid: string | undefined): Promise<SessionUser | null> {
  if (!sid || !SID_RE.test(sid)) return null;
  const r = await query<SessionUser>(
    `SELECT u.id, u.name, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [sid],
  );
  return r.rows[0] ?? null;
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Caminho da área de organizador: /org ou /org/… (sem query string, também na forma decodificada). */
function isOrgPath(req: FastifyRequest): boolean {
  const raw = req.url.split('?')[0];
  const candidates = [raw, safeDecode(raw), req.routeOptions.url ?? ''];
  return candidates.some((p) => p === '/org' || p.startsWith('/org/'));
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('user', null);

  // Hook nº 1 (D2): sessão do cookie sid -> request.user e reply.locals.user.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    req.user = await loadSessionUser(req.cookies?.[SESSION_COOKIE]);
    if (!reply.locals) reply.locals = {};
    reply.locals.user = req.user;
  });

  // Hook nº 2 (D3): defesa em profundidade de R13 para qualquer /org ou /org/*.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (isOrgPath(req)) await requireOrganizer(req, reply);
  });

  await authRoutes(app);
};

export const authPlugin: FastifyPluginAsync = fp(plugin, { name: 'catraca-auth' });
