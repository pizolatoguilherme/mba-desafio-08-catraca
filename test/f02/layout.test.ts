import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';
import { createUser, loginAs, resetDb } from '../helpers.js';

describe('F02 layout', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('layout mostra Entrar e Criar conta para visitante', async () => {
    for (const url of ['/', '/login', '/rota-inexistente']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.body).toContain('<a href="/login" data-nav-login>Entrar</a>');
      expect(res.body).toContain('<a href="/signup" data-nav-signup>Criar conta</a>');
      expect(res.body).not.toContain('data-current-user');
      expect(res.body).not.toContain('action="/logout"');
    }
  });

  it('layout mostra o nome e o botão Sair para usuário logado', async () => {
    const part = await loginAs(app, 'participante@catraca.dev', 'catraca123');
    const res = await app.inject({ method: 'GET', url: '/', headers: { cookie: part } });
    expect(res.body).toContain('<span data-current-user>Participante Seed</span>');
    expect(res.body).toContain('<form method="post" action="/logout" data-logout><button type="submit">Sair</button></form>');
    expect(res.body).toContain('<a href="/me/tickets">Meus ingressos</a>');
    expect(res.body).not.toContain('<a href="/org/events">Meus eventos</a>');
    expect(res.body).not.toContain('data-nav-login');
    expect(res.body).not.toContain('data-nav-signup');

    const org = await loginAs(app, 'org.a@catraca.dev', 'catraca123');
    const r2 = await app.inject({ method: 'GET', url: '/', headers: { cookie: org } });
    expect(r2.body).toContain('<span data-current-user>Organizadora A</span>');
    expect(r2.body).toContain('<a href="/org/events">Meus eventos</a>');
    expect(r2.body).not.toContain('<a href="/me/tickets">Meus ingressos</a>');
    expect(r2.body).toContain('>Sair</button>');

    // escape de HTML do nome
    const evil = await createUser({ role: 'participant', name: '<script>alert("x")</script>', password: 'segredo123' });
    const ec = await loginAs(app, evil.email, 'segredo123');
    const r3 = await app.inject({ method: 'GET', url: '/', headers: { cookie: ec } });
    expect(r3.body).toContain('<span data-current-user>&lt;script&gt;alert(&#34;x&#34;)&lt;/script&gt;</span>');
    expect(r3.body).not.toContain('<script>alert');
  });
});
