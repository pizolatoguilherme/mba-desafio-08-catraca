import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSession } from '../../src/auth/plugin.js';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { createUser, loginAs, resetDb } from '../helpers.js';

describe('F02 sessão', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    app.get('/__test/me', async (req) => ({ user: req.user }));
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('request.user é null sem cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
    const bogus = await app.inject({ method: 'GET', url: '/__test/me', headers: { cookie: 'sid=nao-existe' } });
    expect(bogus.json()).toEqual({ user: null });
  });

  it('request.user é preenchido com sessão válida', async () => {
    const u = await createUser({ role: 'participant', name: 'Fulana', email: 'fulana@example.com' });
    const sid = await createSession(u.id);
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const res = await app.inject({ method: 'GET', url: '/__test/me', headers: { cookie: `${SESSION_COOKIE}=${sid}` } });
    expect(res.json()).toEqual({ user: { id: u.id, name: 'Fulana', email: 'fulana@example.com', role: 'participant' } });
  });

  it('sessão expirada é ignorada', async () => {
    const u = await createUser({ role: 'organizer' });
    const sid = 'x'.repeat(43);
    await query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() - interval '1 second')`, [sid, u.id]);
    const res = await app.inject({ method: 'GET', url: '/__test/me', headers: { cookie: `sid=${sid}` } });
    expect(res.json()).toEqual({ user: null });
    const org = await app.inject({ method: 'GET', url: '/org', headers: { cookie: `sid=${sid}` } });
    expect(org.statusCode).toBe(302);
    expect(org.headers.location).toBe('/login?next=%2Forg');
  });

  it('cookie sid é HttpOnly, SameSite=Lax, Path=/ e dura 7 dias', async () => {
    expect(SESSION_TTL_SECONDS).toBe(604800);
    const res = await app.inject({
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=participante%40catraca.dev&password=catraca123',
    });
    expect(res.statusCode).toBe(303);
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const sidHeaders = raw.filter((h) => h.startsWith('sid='));
    expect(sidHeaders).toHaveLength(1);
    const h = sidHeaders[0];
    expect(h).toMatch(/^sid=[A-Za-z0-9_-]{43};/);
    expect(h).toMatch(/;\s*HttpOnly/i);
    expect(h).toMatch(/;\s*SameSite=Lax/i);
    expect(h).toMatch(/;\s*Path=\/(;|$)/);
    expect(h).toMatch(/;\s*Max-Age=604800/);
    expect(h).not.toMatch(/;\s*Secure/i);
    const sid = /^sid=([^;]+)/.exec(h)![1];
    const r = await query<{ ttl: string }>(
      'SELECT round(extract(epoch from expires_at - created_at))::text AS ttl FROM sessions WHERE id = $1',
      [sid],
    );
    expect(r.rows[0].ttl).toBe('604800');
  });

  it('loginAs devolve o header Cookie de uma sessão válida', async () => {
    const cookie = await loginAs(app, 'org.a@catraca.dev', 'catraca123');
    expect(cookie).toMatch(/^sid=[A-Za-z0-9_-]{43}$/);
    const res = await app.inject({ method: 'GET', url: '/__test/me', headers: { cookie } });
    expect(res.json().user).toMatchObject({ name: 'Organizadora A', email: 'org.a@catraca.dev', role: 'organizer' });
    await expect(loginAs(app, 'org.a@catraca.dev', 'errada')).rejects.toThrow('loginAs falhou: 401');
  });
});
