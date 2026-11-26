import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { apiGet, JSON_CT } from './_support.js';

const KEYS = ['id', 'name', 'startsAt', 'priceCents', 'availableSeats'];
const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/;

type Item = { id: string; name: string; startsAt: string; priceCents: number; availableSeats: number };

describe('F06 listagem de eventos', () => {
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

  async function list(): Promise<Item[]> {
    const res = await apiGet(app, '/api/partner/events');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(JSON_CT);
    return res.json<Item[]>();
  }

  it('C-F06-01 plugin de parceiros responde JSON sob /api/partner', async () => {
    const res = await apiGet(app, '/api/partner/events');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(JSON_CT);
    expect(Array.isArray(res.json())).toBe(true);
    // O escopo do plugin não vaza para fora do prefixo.
    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(String(home.headers['content-type'])).toContain('text/html');
    const missing = await app.inject({ method: 'GET', url: '/nao-existe' });
    expect(missing.statusCode).toBe(404);
    expect(String(missing.headers['content-type'])).toContain('text/html');
  });

  it('C-F06-04 lista só eventos published com exatamente id, name, startsAt, priceCents e availableSeats', async () => {
    const startsAt = new Date('2026-12-06T00:00:00Z');
    const pub = await createEvent({ organizerId: org, name: 'Show Publicado', startsAt, priceCents: 3500, capacity: 7 });
    const draft = await createEvent({ organizerId: org, status: 'draft', name: 'Rascunho' });
    const cancelled = await createEvent({ organizerId: org, status: 'cancelled', name: 'Cancelado' });

    const items = await list();
    const ids = items.map((i) => i.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(cancelled.id);

    for (const item of items) {
      expect(Object.keys(item)).toEqual(KEYS);
      expect(typeof item.id).toBe('string');
      expect(item.id).toMatch(/^evt_[a-z0-9]{10}$/);
      expect(typeof item.name).toBe('string');
      expect(typeof item.startsAt).toBe('string');
      expect(item.startsAt).toMatch(ISO_OFFSET);
      expect(Number.isInteger(item.priceCents)).toBe(true);
      expect(Number.isInteger(item.availableSeats)).toBe(true);
    }

    const mine = items.find((i) => i.id === pub.id);
    expect(mine).toEqual({
      id: pub.id,
      name: 'Show Publicado',
      startsAt: '2026-12-05T21:00:00-03:00',
      priceCents: 3500,
      availableSeats: 7,
    });
    expect(new Date(mine!.startsAt).getTime()).toBe(startsAt.getTime());
  });

  it('C-F06-04 availableSeats segue R05: pending e confirmed ocupam, declined não', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 5 });
    for (const status of ['pending', 'confirmed', 'declined', 'cancelled'] as const) {
      await insertTicket({ eventId: ev.id, status });
    }
    expect((await list()).find((i) => i.id === ev.id)?.availableSeats).toBe(3);

    // Lotado não fica negativo nem some da listagem.
    const full = await createEvent({ organizerId: org, capacity: 1 });
    await insertTicket({ eventId: full.id, status: 'confirmed' });
    expect((await list()).find((i) => i.id === full.id)?.availableSeats).toBe(0);
  });

  it('C-F06-04 evento cancelled por fixture não aparece na listagem', async () => {
    const cancelled = await createEvent({ organizerId: org, status: 'cancelled', capacity: 5 });
    await insertTicket({ eventId: cancelled.id, status: 'refunded' });
    const items = await list();
    expect(items.map((i) => i.id)).not.toContain(cancelled.id);
  });
});
