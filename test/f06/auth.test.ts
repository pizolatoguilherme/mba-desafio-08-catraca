import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, resetDb } from '../helpers.js';
import { apiBuy, apiGet, expectJson, KEY, ticketCount, validBody } from './_support.js';

describe('F06 autenticação X-Api-Key', () => {
  let app: FastifyInstance;
  let eventId: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    const org = (await createUser({ role: 'organizer' })).id;
    eventId = (await createEvent({ organizerId: org, capacity: 5 })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F06-02 as três rotas sem X-Api-Key ou com chave errada respondem 401 unauthorized', async () => {
    const keys: Array<string | null> = [null, 'chave-errada', '', `${KEY}x`];
    for (const key of keys) {
      expectJson(await apiGet(app, '/api/partner/events', key), 401, { error: 'unauthorized' });
      expectJson(await apiBuy(app, eventId, validBody(), { key }), 401, { error: 'unauthorized' });
      expectJson(await apiGet(app, '/api/partner/tickets/tkt_aaaaaaaaaa', key), 401, { error: 'unauthorized' });
    }
    // Cabeçalho repetido (o Node entrega como array) também não autentica.
    const twice = await app.inject({
      method: 'GET',
      url: '/api/partner/events',
      headers: { 'x-api-key': [KEY, KEY] as unknown as string },
    });
    expectJson(twice, 401, { error: 'unauthorized' });
    expect(await ticketCount()).toBe(0);
  });

  it('C-F06-02 a chave é checada antes do parsing: corpo malformado sem chave dá 401', async () => {
    expectJson(await apiBuy(app, eventId, '{oops', { key: null, contentType: 'text/plain' }), 401, { error: 'unauthorized' });
    expectJson(await apiBuy(app, eventId, '{oops', { key: null }), 401, { error: 'unauthorized' });
    expectJson(await apiBuy(app, eventId, '{oops', { key: 'errada', contentType: null }), 401, { error: 'unauthorized' });
    expectJson(await apiBuy(app, eventId, 'x'.repeat(20 * 1024), { key: null }), 401, { error: 'unauthorized' });
    expect(await ticketCount()).toBe(0);
  });

  it('C-F06-03 chave correta passa e o cabeçalho não diferencia maiúsculas', async () => {
    const lower = await app.inject({ method: 'GET', url: '/api/partner/events', headers: { 'x-api-key': KEY } });
    expect(lower.statusCode).toBe(200);
    const upper = await app.inject({ method: 'GET', url: '/api/partner/events', headers: { 'X-API-KEY': KEY } });
    expect(upper.statusCode).toBe(200);
    expect(upper.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('C-F06-03 rota desconhecida sob /api/partner: 401 sem chave e 404 JSON com chave', async () => {
    expectJson(await apiGet(app, '/api/partner/xyz', null), 401, { error: 'unauthorized' });
    expectJson(await apiGet(app, '/api/partner/xyz'), 404, { error: 'not_found' });
    expectJson(await app.inject({ method: 'DELETE', url: '/api/partner/events', headers: { 'x-api-key': KEY } }), 404, {
      error: 'not_found',
    });
    expectJson(await app.inject({ method: 'DELETE', url: '/api/partner/events' }), 401, { error: 'unauthorized' });
  });
});
