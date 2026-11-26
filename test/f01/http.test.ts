import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/db.js';
import { featurePlugins } from '../../src/features.js';
import { buildApp } from '../../src/server.js';

let app: FastifyInstance | undefined;
let saved: FastifyPluginAsync[] | undefined;

/** Esvazia featurePlugins (e opcionalmente põe plugins de teste); afterEach restaura o conteúdo. */
function usePlugins(...plugins: FastifyPluginAsync[]): void {
  saved = featurePlugins.splice(0, featurePlugins.length, ...plugins);
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  app = undefined;
  if (saved) featurePlugins.splice(0, featurePlugins.length, ...saved);
  saved = undefined;
});

describe('C-F01-20 http', () => {
  it('GET /healthz responde 200 com {ok:true}', async () => {
    app = await buildApp({ startDispatcher: false });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.body).toBe('{"ok":true}');
  });

  it('GET / renderiza o placeholder dentro do layout', async () => {
    usePlugins();
    app = await buildApp({ startDispatcher: false });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.body).toMatch(/^<!doctype html>/i);
    expect(res.body).toContain('<html lang="pt-BR">');
    expect(res.body).toContain('<meta charset="utf-8">');
    expect(res.body).toContain('<title>Catraca</title>');
    expect(res.body).toContain('<a href="/" data-brand>Catraca</a>');
    expect(res.body).toContain('<nav data-nav></nav>');
    expect(res.body).toContain(
      '<main><section data-page="home"><h1>Catraca</h1><p>Vitrine em construção.</p></section>',
    );
  });

  it('rota inexistente responde 404 com error.ejs', async () => {
    // Só o core: com F02, visitante em /org/* inexistente é barrado (302) antes do 404 (spec F02 D3).
    usePlugins();
    app = await buildApp({ startDispatcher: false });
    for (const url of ['/rota-que-nao-existe', '/org/events/evt_inexistente/x']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toMatch(/^text\/html/);
      expect(res.body).toContain('<html lang="pt-BR">');
      expect(res.body).toContain('<section data-page="error">');
      expect(res.body).toContain('<h1 data-error-status="404">Página não encontrada</h1>');
      expect(res.body).toContain('<p>O endereço acessado não existe ou não está disponível.</p>');
    }
    const post = await app.inject({ method: 'POST', url: '/nada', payload: { a: 1 } });
    expect(post.statusCode).toBe(404);
  });

  it('buildApp registra featurePlugins em ordem', async () => {
    const order: string[] = [];
    const a: FastifyPluginAsync = async (f) => {
      order.push('a');
      // o core já está registrado: a feature usa as views e o layout
      f.get('/teste-a', (_req, reply) => reply.code(403).view('error.ejs', { status: 403, title: 'Acesso negado' }));
    };
    const b: FastifyPluginAsync = async (f) => {
      order.push('b');
      f.get('/teste-b', async () => ({ plugin: 'b' }));
    };
    usePlugins(a, b);
    app = await buildApp({ startDispatcher: false });
    expect(order).toEqual(['a', 'b']);
    const ra = await app.inject({ method: 'GET', url: '/teste-a' });
    expect(ra.statusCode).toBe(403);
    expect(ra.body).toContain('<html lang="pt-BR">');
    expect(ra.body).toContain('<h1 data-error-status="403">Acesso negado</h1>');
    const rb = await app.inject({ method: 'GET', url: '/teste-b' });
    expect(rb.json()).toEqual({ plugin: 'b' });
  });

  it('placeholder de GET / não é registrado se uma feature já registrou GET /', async () => {
    const vitrine: FastifyPluginAsync = async (f) => {
      f.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send('<p data-page="vitrine">ok</p>'));
    };
    usePlugins(vitrine);
    app = await buildApp({ startDispatcher: false });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<p data-page="vitrine">ok</p>');
    expect(res.body).not.toContain('data-page="home"');
  });

  // Complementos (não nomeados no contrato): falhas do banco, erro 500 e o roteador.
  it('GET /healthz responde 503 com {ok:false} se o banco falha', async () => {
    app = await buildApp({ startDispatcher: false });
    vi.spyOn(pool, 'query').mockImplementation((() => Promise.reject(new Error('sem banco'))) as never);
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('{"ok":false}');
  });

  it('erro não tratado responde 500 com error.ejs, sem stack trace', async () => {
    usePlugins(async (f) => {
      f.get('/explode', async () => {
        throw new Error('detalhe-interno-secreto');
      });
    });
    app = await buildApp({ startDispatcher: false });
    const res = await app.inject({ method: 'GET', url: '/explode' });
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('<h1 data-error-status="500">Erro interno</h1>');
    expect(res.body).not.toContain('detalhe-interno-secreto');
    expect(res.body).not.toContain('at ');
  });

  it('roteador aceita parâmetros de até 500 caracteres e URL malformada em /api/partner vira 422', async () => {
    usePlugins(async (f) => {
      f.get('/api/partner/tickets/:id', async (req) => ({ len: (req.params as { id: string }).id.length }));
      f.get('/events/:id', async () => ({ ok: true }));
    });
    app = await buildApp({ startDispatcher: false });
    const long = await app.inject({ method: 'GET', url: `/api/partner/tickets/${'x'.repeat(300)}` });
    expect(long.json()).toEqual({ len: 300 });
    const bad = await app.inject({ method: 'GET', url: '/api/partner/tickets/%zz' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toEqual({ error: 'invalid_request' });
    const badWeb = await app.inject({ method: 'GET', url: '/events/%zz' });
    expect(badWeb.statusCode).toBe(400);
  });
});
