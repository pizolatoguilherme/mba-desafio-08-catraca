import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TicketStatus } from '../../src/format.js';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { apiGet, expectJson, JSON_CT } from './_support.js';

type TicketBody = { ticketId: string; code: string; eventId: string; status: string; checkedIn: boolean };

describe('F06 consulta de ingresso', () => {
  let app: FastifyInstance;
  let eventId: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    const org = (await createUser({ role: 'organizer' })).id;
    eventId = (await createEvent({ organizerId: org, capacity: 10 })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function lookup(id: string): Promise<TicketBody> {
    const res = await apiGet(app, `/api/partner/tickets/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(JSON_CT);
    return res.json<TicketBody>();
  }

  it('C-F06-07 consulta devolve exatamente ticketId, code, eventId, status e checkedIn', async () => {
    const t = await insertTicket({ eventId, channel: 'partner', status: 'pending' });
    const body = await lookup(t.id);
    expect(Object.keys(body)).toEqual(['ticketId', 'code', 'eventId', 'status', 'checkedIn']);
    expect(typeof body.ticketId).toBe('string');
    expect(typeof body.code).toBe('string');
    expect(typeof body.eventId).toBe('string');
    expect(typeof body.status).toBe('string');
    expect(typeof body.checkedIn).toBe('boolean');
    expect(body).toEqual({ ticketId: t.id, code: t.code, eventId, status: 'pending', checkedIn: false });
  });

  it('C-F06-07 checkedIn reflete tickets.checked_in_at da fixture insertTicket', async () => {
    const used = await insertTicket({ eventId, status: 'confirmed', checkedIn: true });
    const fresh = await insertTicket({ eventId, status: 'confirmed' });
    expect(await lookup(used.id)).toEqual({ ticketId: used.id, code: used.code, eventId, status: 'confirmed', checkedIn: true });
    expect(await lookup(fresh.id)).toEqual({ ticketId: fresh.id, code: fresh.code, eventId, status: 'confirmed', checkedIn: false });
  });

  it('C-F06-07 status da consulta usa os valores da API para os 5 status', async () => {
    const all: TicketStatus[] = ['pending', 'confirmed', 'declined', 'cancelled', 'refunded'];
    for (const status of all) {
      const t = await insertTicket({ eventId, status });
      const body = await lookup(t.id);
      expect(body.status).toBe(status);
      expect(body.checkedIn).toBe(false);
    }
  });

  it('C-F06-07 ingresso inexistente responde 404 ticket_not_found', async () => {
    expectJson(await apiGet(app, '/api/partner/tickets/tkt_naoexiste0'), 404, { error: 'ticket_not_found' });
    expectJson(await apiGet(app, '/api/partner/tickets/tkt_aaaaaaaaaa'), 404, { error: 'ticket_not_found' });
  });
});
