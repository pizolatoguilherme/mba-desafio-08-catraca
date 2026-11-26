import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { loginAs, resetDb } from '../helpers.js';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

describe('F02 login e logout', () => {
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

  function login(fields: Record<string, string>) {
    return app.inject({ method: 'POST', url: '/login', headers: FORM, payload: new URLSearchParams(fields).toString() });
  }

  async function sessionCount(): Promise<number> {
    const r = await query<{ n: string }>('SELECT count(*)::text AS n FROM sessions');
    return Number(r.rows[0].n);
  }

  it('login do participante da seed redireciona para /', async () => {
    const page = await app.inject({ method: 'GET', url: '/login' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<form method="post" action="/login">');
    for (const n of ['name="email"', 'name="password"', 'name="next"', 'Entrar', 'href="/signup"']) {
      expect(page.body).toContain(n);
    }
    const res = await login({ email: 'Participante@Catraca.dev', password: 'catraca123' });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
    const sid = res.cookies.find((c) => c.name === 'sid')?.value;
    expect(sid).toBeTruthy();
    const me = await app.inject({ method: 'GET', url: '/__test/me', headers: { cookie: `sid=${sid}` } });
    expect(me.json().user).toMatchObject({ name: 'Participante Seed', role: 'participant' });
  });

  it('login do participante respeita next seguro e ignora next externo', async () => {
    const page = await app.inject({ method: 'GET', url: '/login?next=%2Fme%2Ftickets' });
    expect(page.body).toContain('name="next" value="/me/tickets"');
    const ok = await login({ email: 'participante@catraca.dev', password: 'catraca123', next: '/me/tickets' });
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe('/me/tickets');
    for (const next of ['//evil.example.com/x', 'https://evil.example.com/', '/\\evil.example.com', 'javascript:alert(1)']) {
      const res = await login({ email: 'participante@catraca.dev', password: 'catraca123', next });
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/');
    }
  });

  it('login do organizador redireciona para /org/events', async () => {
    for (const [email, next] of [
      ['org.a@catraca.dev', ''],
      ['org.b@catraca.dev', '/me/tickets'],
    ]) {
      const res = await login({ email, password: 'catraca123', next });
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/org/events');
      expect(res.cookies.find((c) => c.name === 'sid')?.value).toBeTruthy();
    }
  });

  it('login com senha errada responde 401 sem criar sessão', async () => {
    const before = await sessionCount();
    const res = await login({ email: 'participante@catraca.dev', password: 'senha-errada' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toContain('<p data-form-error>E-mail ou senha inválidos.</p>');
    expect(res.body).toContain('value="participante@catraca.dev"');
    const empty = await login({ email: 'participante@catraca.dev', password: '' });
    expect(empty.statusCode).toBe(401);
    expect(await sessionCount()).toBe(before);
  });

  it('login com e-mail inexistente responde 401 sem criar sessão', async () => {
    const before = await sessionCount();
    const res = await login({ email: 'ninguem@catraca.dev', password: 'catraca123' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toContain('<p data-form-error>E-mail ou senha inválidos.</p>');
    const none = await app.inject({ method: 'POST', url: '/login' });
    expect(none.statusCode).toBe(401);
    expect(await sessionCount()).toBe(before);
  });

  it('logout apaga a sessão e limpa o cookie', async () => {
    const cookie = await loginAs(app, 'participante@catraca.dev', 'catraca123');
    const sid = cookie.slice('sid='.length);
    const res = await app.inject({ method: 'POST', url: '/logout', headers: { cookie } });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((h) => h.startsWith('sid='));
    expect(set).toMatch(/^sid=;/);
    expect(set).toMatch(/Expires=Thu, 01 Jan 1970 00:00:00 GMT|Max-Age=0/);
    const s = await query('SELECT 1 FROM sessions WHERE id = $1', [sid]);
    expect(s.rowCount).toBe(0);
    const me = await app.inject({ method: 'GET', url: '/__test/me', headers: { cookie } });
    expect(me.json()).toEqual({ user: null });
    const org = await app.inject({ method: 'GET', url: '/org', headers: { cookie } });
    expect(org.statusCode).toBe(302);
    expect(org.headers.location).toBe('/login?next=%2Forg');
    // sem sessão também redireciona
    const anon = await app.inject({ method: 'POST', url: '/logout' });
    expect(anon.statusCode).toBe(303);
    expect(anon.headers.location).toBe('/');
  });

  it('GET /logout também encerra a sessão', async () => {
    const cookie = await loginAs(app, 'org.a@catraca.dev', 'catraca123');
    const sid = cookie.slice('sid='.length);
    const res = await app.inject({ method: 'GET', url: '/logout', headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const s = await query('SELECT 1 FROM sessions WHERE id = $1', [sid]);
    expect(s.rowCount).toBe(0);
  });
});
