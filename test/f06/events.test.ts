import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';

describe('F06 listagem de eventos', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('plugin de parceiros responde JSON sob /api/partner', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/partner/events', headers: { 'x-api-key': 'catraca-parceiro-2026' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(String(home.headers['content-type'])).toContain('text/html');
  });
});
