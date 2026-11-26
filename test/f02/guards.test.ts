import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requireOrganizer, requireParticipant } from '../../src/auth/guards.js';
import { createSession } from '../../src/auth/plugin.js';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, loginAs, resetDb } from '../helpers.js';

describe('F02 guards', () => {
  let app: FastifyInstance;
  const calls = { participante: 0, acao: 0 };

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    app.get('/__test/participante', { preHandler: requireParticipant }, async () => {
      calls.participante++;
      return { ok: true };
    });
    app.post('/org/__test/acao', { preHandler: requireOrganizer }, async () => {
      calls.acao++;
      return { ok: true };
    });
    // Rota sem guard próprio: só o hook global de /org/* a protege.
    app.get('/org/__test/sem-guard', async () => {
      calls.acao++;
      return { ok: true };
    });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    calls.participante = 0;
    calls.acao = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  async function orgAId(): Promise<string> {
    const r = await query<{ id: string }>("SELECT id FROM users WHERE email = 'org.a@catraca.dev'");
    return r.rows[0].id;
  }

  it('visitante em /org é redirecionado para /login com next', async () => {
    const res = await app.inject({ method: 'GET', url: '/org' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login?next=%2Forg');
  });

  it('visitante em qualquer rota /org/* é redirecionado para /login', async () => {
    const cases: Array<[string, string]> = [
      ['GET', '/org/events'],
      ['GET', '/org/events/evt_qualquer00'],
      ['GET', '/org/events/new?x=1'],
      ['POST', '/org/events/new'],
      ['GET', '/org/__test/sem-guard'],
      ['GET', '/%6Frg/events'],
    ];
    for (const [method, url] of cases) {
      const res = await app.inject({ method: method as 'GET' | 'POST', url, payload: method === 'POST' ? { name: 'x' } : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(302);
      expect(res.headers.location).toBe(`/login?next=${encodeURIComponent(url)}`);
    }
    expect(calls.acao).toBe(0);
  });

  it('participante em /org/* recebe 403 sem dados de evento', async () => {
    const ev = await createEvent({
      organizerId: await orgAId(),
      name: 'Evento Secreto F02',
      venue: 'Porão Secreto',
      priceCents: 4321,
    });
    const cookie = await loginAs(app, 'participante@catraca.dev', 'catraca123');
    const urls = ['/org', '/org/events', `/org/events/${ev.id}`, `/org/events/${ev.id}/checkin`, '/org/__test/sem-guard'];
    for (const url of urls) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, url).toBe(403);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.body).toContain('<h1 data-error-status="403">Acesso negado</h1>');
      expect(res.body).toContain('Esta área é restrita a organizadores.');
      expect(res.body).not.toMatch(/Evento Secreto F02|Porão Secreto|43,21/);
    }
    const post = await app.inject({
      method: 'POST',
      url: `/org/events/${ev.id}/checkin`,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'code=ABC',
    });
    expect(post.statusCode).toBe(403);
    expect(post.body).not.toMatch(/Evento Secreto F02|Porão Secreto|43,21/);
    expect(calls.acao).toBe(0);
  });

  it('organizador em /org é redirecionado para /org/events', async () => {
    const org = await createUser({ role: 'organizer' });
    const cookie = `sid=${await createSession(org.id)}`;
    const res = await app.inject({ method: 'GET', url: '/org', headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/org/events');
    const seed = await loginAs(app, 'org.b@catraca.dev', 'catraca123');
    const res2 = await app.inject({ method: 'GET', url: '/org', headers: { cookie: seed } });
    expect(res2.statusCode).toBe(302);
    expect(res2.headers.location).toBe('/org/events');
    // Organizador passa pelo hook: rota inexistente de /org/* cai no 404 genérico.
    const missing = await app.inject({ method: 'GET', url: '/org/events', headers: { cookie: seed } });
    expect(missing.statusCode).toBe(404);
  });

  it('requireOrganizer não executa o handler quando barra', async () => {
    const visitor = await app.inject({ method: 'POST', url: '/org/__test/acao', payload: { a: 1 } });
    expect(visitor.statusCode).toBe(302);
    expect(visitor.headers.location).toBe('/login?next=%2Forg%2F__test%2Facao');
    const cookie = await loginAs(app, 'participante@catraca.dev', 'catraca123');
    const part = await app.inject({ method: 'POST', url: '/org/__test/acao', headers: { cookie }, payload: { a: 1 } });
    expect(part.statusCode).toBe(403);
    expect(calls.acao).toBe(0);

    // Chamado diretamente (sem o hook global), o guard também barra antes do handler.
    const direct = await buildApp({ startDispatcher: false });
    let ran = 0;
    direct.post('/area-restrita', { preHandler: requireOrganizer }, async () => {
      ran++;
      return { ok: true };
    });
    await direct.ready();
    const r1 = await direct.inject({ method: 'POST', url: '/area-restrita', payload: { a: 1 } });
    expect(r1.statusCode).toBe(302);
    const r2 = await direct.inject({ method: 'POST', url: '/area-restrita', headers: { cookie }, payload: { a: 1 } });
    expect(r2.statusCode).toBe(403);
    expect(r2.body).toContain('<h1 data-error-status="403">Acesso negado</h1>');
    expect(ran).toBe(0);
    const org = await loginAs(direct, 'org.a@catraca.dev', 'catraca123');
    const r3 = await direct.inject({ method: 'POST', url: '/area-restrita', headers: { cookie: org }, payload: { a: 1 } });
    expect(r3.statusCode).toBe(200);
    expect(ran).toBe(1);
    await direct.close();

    const okOrg = await app.inject({ method: 'POST', url: '/org/__test/acao', headers: { cookie: org }, payload: { a: 1 } });
    expect(okOrg.statusCode).toBe(200);
    expect(calls.acao).toBe(1);
  });

  it('requireParticipant redireciona visitante para /login com next', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/participante?x=1' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login?next=%2F__test%2Fparticipante%3Fx%3D1');
    expect(calls.participante).toBe(0);
  });

  it('requireParticipant responde 403 para organizador', async () => {
    const cookie = await loginAs(app, 'org.a@catraca.dev', 'catraca123');
    const res = await app.inject({ method: 'GET', url: '/__test/participante', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('<h1 data-error-status="403">Acesso negado</h1>');
    expect(res.body).toContain('Esta área é restrita a participantes.');
    expect(calls.participante).toBe(0);
  });

  it('requireParticipant deixa passar participante', async () => {
    const cookie = await loginAs(app, 'participante@catraca.dev', 'catraca123');
    const res = await app.inject({ method: 'GET', url: '/__test/participante', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(calls.participante).toBe(1);
  });
});
