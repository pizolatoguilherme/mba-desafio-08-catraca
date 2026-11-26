import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';

describe('F02 sessão', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    app.get('/__test/me', async (req) => ({ user: req.user }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('request.user é null sem cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
  });
});
