import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, resetDb } from '../helpers.js';
import { apiBuy, apiGet, CARD_0001, ticketCount, validBody } from './_support.js';

describe('F06 rajada HTTP de compras pela API (R07)', () => {
  let app: FastifyInstance;
  let org: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    org = (await createUser({ role: 'organizer' })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F06-10 30 POST simultâneos × 10 rodadas: exatamente 5 respostas 202 e 25 respostas 409', async () => {
    for (let round = 1; round <= 10; round++) {
      const ev = await createEvent({ organizerId: org, capacity: 5, name: `Carga ${round}` });
      const responses = await Promise.all(
        Array.from({ length: 30 }, (_, i) => apiBuy(app, ev.id, validBody(`carga${i + 1}@example.com`, CARD_0001))),
      );
      const accepted = responses.filter((r) => r.statusCode === 202);
      const rejected = responses.filter((r) => r.statusCode === 409);
      expect({ round, accepted: accepted.length, rejected: rejected.length }).toEqual({ round, accepted: 5, rejected: 25 });
      for (const r of rejected) expect(r.body).toBe('{"error":"sold_out"}');

      const ids = new Set(accepted.map((r) => r.json<{ ticketId: string }>().ticketId));
      const codes = new Set(accepted.map((r) => r.json<{ code: string }>().code));
      expect(ids.size).toBe(5);
      expect(codes.size).toBe(5);
      expect(await ticketCount(ev.id)).toBe(5);

      const listed = (await apiGet(app, '/api/partner/events')).json<Array<{ id: string; availableSeats: number }>>();
      expect(listed.find((e) => e.id === ev.id)?.availableSeats).toBe(0);
    }
  });
});
