import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db.js';
import { newId } from '../ids.js';
import { requireOrganizer } from './guards.js';
import { hashPassword, verifyPassword } from './password.js';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSession, destroySession } from './plugin.js';

const MSG = {
  empty: 'Preencha nome, e-mail e senha.',
  email: 'Informe um e-mail válido.',
  shortPassword: 'A senha precisa ter pelo menos 6 caracteres.',
  duplicate: 'Este e-mail já está cadastrado.',
  badLogin: 'E-mail ou senha inválidos.',
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;
// Hash de referência para equalizar o tempo de resposta do login com e-mail inexistente.
const DUMMY_HASH = hashPassword('catraca-dummy-password');

/** D10: next seguro = caminho local ("/…"), sem "//", "/\", caracteres de controle e com até 2048 caracteres. */
export function safeNext(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2048) return '/';
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return '/';
  return v;
}

/** Lê um campo de formulário como string (campo repetido, ausente ou não-string -> ''). */
function field(body: unknown, name: string): string {
  if (!body || typeof body !== 'object') return '';
  const v = (body as Record<string, unknown>)[name];
  return typeof v === 'string' ? v : '';
}

function queryParam(req: FastifyRequest, name: string): string {
  return field(req.query, name);
}

function setSessionCookie(reply: FastifyReply, sid: string): void {
  reply.setCookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS });
}

function validateSignup(name: string, email: string, password: string): string | null {
  if (!name.trim() || !email.trim() || !password.trim()) return MSG.empty;
  const e = email.trim();
  if (e.length > 254 || !EMAIL_RE.test(e)) return MSG.email;
  if (password.length < MIN_PASSWORD) return MSG.shortPassword;
  return null;
}

async function logout(req: FastifyRequest, reply: FastifyReply, code: 302 | 303): Promise<FastifyReply> {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) await destroySession(sid);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return reply.redirect('/', code);
}

/** Rotas de conta (registradas por authPlugin): /signup, /login, /logout e o índice /org. */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/signup', (req, reply) =>
    reply.view('auth/signup.ejs', { form: { name: '', email: '' }, next: safeNext(queryParam(req, 'next')), error: null }),
  );

  app.post('/signup', async (req, reply) => {
    // D8: só estes campos são lidos; role é sempre o literal 'participant'.
    const name = field(req.body, 'name');
    const email = field(req.body, 'email');
    const password = field(req.body, 'password');
    const next = safeNext(field(req.body, 'next'));
    const fail = (error: string) =>
      reply.code(422).view('auth/signup.ejs', { form: { name, email }, next, error });

    const invalid = validateSignup(name, email, password);
    if (invalid) return fail(invalid);

    const normalized = email.trim().toLowerCase();
    const dup = await query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [normalized]);
    if (dup.rowCount) return fail(MSG.duplicate);

    const id = newId('usr');
    try {
      await query(`INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'participant')`, [
        id,
        name.trim(),
        normalized,
        await hashPassword(password),
      ]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return fail(MSG.duplicate);
      throw err;
    }

    setSessionCookie(reply, await createSession(id));
    return reply.redirect(next, 303);
  });

  app.get('/login', (req, reply) =>
    reply.view('auth/login.ejs', { form: { email: '' }, next: safeNext(queryParam(req, 'next')), error: null }),
  );

  app.post('/login', async (req, reply) => {
    const email = field(req.body, 'email');
    const password = field(req.body, 'password');
    const next = safeNext(field(req.body, 'next'));

    const r = await query<{ id: string; role: 'participant' | 'organizer'; password_hash: string }>(
      'SELECT id, role, password_hash FROM users WHERE lower(email) = lower($1)',
      [email.trim().toLowerCase()],
    );
    const user = r.rows[0];
    // E-mail inexistente também paga um scrypt, para não revelar pelo tempo quais contas existem.
    const ok = await verifyPassword(password, user ? user.password_hash : await DUMMY_HASH);
    if (!user || !ok) {
      return reply.code(401).view('auth/login.ejs', { form: { email }, next, error: MSG.badLogin });
    }

    await query('DELETE FROM sessions WHERE user_id = $1 AND expires_at <= now()', [user.id]);
    setSessionCookie(reply, await createSession(user.id));
    return reply.redirect(user.role === 'organizer' ? '/org/events' : next, 303);
  });

  app.post('/logout', (req, reply) => logout(req, reply, 303));
  app.get('/logout', (req, reply) => logout(req, reply, 302));

  // Índice da área de organizador (o hook global de /org já barra visitante e participante).
  app.get('/org', { preHandler: requireOrganizer }, (_req, reply) => reply.redirect('/org/events', 302));
}
