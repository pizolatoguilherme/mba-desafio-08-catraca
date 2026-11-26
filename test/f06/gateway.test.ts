import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDispatcher, type Dispatcher } from '../../src/gateway/dispatcher.js';
import { SimulatedGateway } from '../../src/gateway/simulated.js';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, resetDb } from '../helpers.js';
import { apiBuy, apiGet, CARD_0001, CARD_0004, validBody, waitFor } from './_support.js';

type TicketBody = { ticketId: string; code: string; eventId: string; status: string; checkedIn: boolean };

describe('F06 resultado do gateway pela API (escala 0,01)', () => {
  let app: FastifyInstance;
  let org: string;
  let d: Dispatcher | null = null;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    org = (await createUser({ role: 'organizer' })).id;
  });

  afterEach(async () => {
    await d?.stop();
    d = null;
  });

  afterAll(async () => {
    await app.close();
  });

  async function ticket(id: string): Promise<TicketBody> {
    const res = await apiGet(app, `/api/partner/tickets/${id}`);
    expect(res.statusCode).toBe(200);
    return res.json<TicketBody>();
  }

  async function seats(eventId: string): Promise<number | undefined> {
    const list = (await apiGet(app, '/api/partner/events')).json<Array<{ id: string; availableSeats: number }>>();
    return list.find((e) => e.id === eventId)?.availableSeats;
  }

  it('C-F06-11 0001 fica confirmed e 0004 fica pending e depois declined liberando a vaga', async () => {
    // O singleton fica parado (kick() é no-op); este dispatcher de teste pega os pagamentos por polling.
    // Escala 0,01: 0001 em 20–40 ms, 0004 em 300–400 ms.
    d = createDispatcher({ gateway: new SimulatedGateway({ scale: 0.01 }), pollMs: 20 });
    const ev = await createEvent({ organizerId: org, capacity: 5 });
    expect(await seats(ev.id)).toBe(5);

    const ok = await apiBuy(app, ev.id, validBody('ok@example.com', CARD_0001));
    const slow = await apiBuy(app, ev.id, validBody('lenta@example.com', CARD_0004));
    expect([ok.statusCode, slow.statusCode]).toEqual([202, 202]);
    const okId = ok.json<{ ticketId: string }>().ticketId;
    const slowId = slow.json<{ ticketId: string }>().ticketId;
    expect((await ticket(okId)).status).toBe('pending');
    expect((await ticket(slowId)).status).toBe('pending');
    expect(await seats(ev.id)).toBe(3);

    d.start();
    await waitFor(async () => (await ticket(okId)).status === 'confirmed');
    // 0001 confirmado continua ocupando; 0004 ainda pendente também ocupa.
    expect(await ticket(slowId)).toEqual({
      ticketId: slowId,
      code: slow.json<{ code: string }>().code,
      eventId: ev.id,
      status: 'pending',
      checkedIn: false,
    });
    expect(await seats(ev.id)).toBe(3);

    await waitFor(async () => (await ticket(slowId)).status !== 'pending');
    expect((await ticket(slowId)).status).toBe('declined');
    expect((await ticket(okId)).status).toBe('confirmed');
    // Recusado libera a vaga: só o confirmado ocupa.
    expect(await seats(ev.id)).toBe(4);
  });
});
