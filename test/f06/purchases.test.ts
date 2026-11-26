import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { apiBuy, CARD_0001, expectJson, JSON_CT, ticketCount, validBody } from './_support.js';

const INVALID = { buyerEmail: 'x@example.com', cardNumber: '123' };

describe('F06 compra pela API', () => {
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

  it('C-F06-05 compra válida responde 202 com exatamente ticketId, code e status pending', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 5, priceCents: 4200 });
    const res = await apiBuy(app, ev.id, { ...validBody('ana@example.com', CARD_0001), extra: 'ignorado' });
    expect(res.statusCode).toBe(202);
    expect(res.headers['content-type']).toBe(JSON_CT);
    const body = res.json<{ ticketId: string; code: string; status: string }>();
    expect(Object.keys(body)).toEqual(['ticketId', 'code', 'status']);
    expect(body.ticketId).toMatch(/^tkt_[a-z0-9]{10}$/);
    expect(body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(body.status).toBe('pending');

    const row = await query<{ event_id: string; channel: string; user_id: string | null; buyer_email: string; code: string; status: string; price_cents: number; card_last4: string }>(
      'SELECT event_id, channel, user_id, buyer_email, code, status, price_cents, card_last4 FROM tickets WHERE id = $1',
      [body.ticketId],
    );
    expect(row.rows[0]).toEqual({
      event_id: ev.id,
      channel: 'partner',
      user_id: null,
      buyer_email: 'ana@example.com',
      code: body.code,
      status: 'pending',
      price_cents: 4200,
      card_last4: '0001',
    });
    // Pagamento enfileirado para o dispatcher (a resposta não espera o gateway).
    const pay = await query<{ n: number }>('SELECT count(*)::int AS n FROM payments WHERE ticket_id = $1', [body.ticketId]);
    expect(pay.rows[0].n).toBe(1);

    // application/json com charset também é aceito.
    const withCharset = await apiBuy(app, ev.id, validBody('bia@example.com'), { contentType: 'application/json; charset=utf-8' });
    expect(withCharset.statusCode).toBe(202);
  });

  it('C-F06-05 ordem de erros da compra: 422 antes de 404 antes de 409', async () => {
    const full = await createEvent({ organizerId: org, capacity: 1 });
    await insertTicket({ eventId: full.id, status: 'pending' });
    const draft = await createEvent({ organizerId: org, status: 'draft', capacity: 5 });
    const cancelled = await createEvent({ organizerId: org, status: 'cancelled', capacity: 5 });
    const missing = 'evt_naoexiste0';
    const before = await ticketCount();

    // corpo inválido vence o evento inexistente, o rascunho e o lotado
    expectJson(await apiBuy(app, missing, INVALID), 422, { error: 'invalid_request' });
    expectJson(await apiBuy(app, draft.id, INVALID), 422, { error: 'invalid_request' });
    expectJson(await apiBuy(app, full.id, INVALID), 422, { error: 'invalid_request' });
    expectJson(await apiBuy(app, full.id, '{oops'), 422, { error: 'invalid_request' });
    // corpo válido: evento indisponível -> 404
    expectJson(await apiBuy(app, missing, validBody()), 404, { error: 'event_not_available' });
    expectJson(await apiBuy(app, draft.id, validBody()), 404, { error: 'event_not_available' });
    expectJson(await apiBuy(app, cancelled.id, validBody()), 404, { error: 'event_not_available' });
    // corpo válido + evento à venda sem vaga -> 409
    expectJson(await apiBuy(app, full.id, validBody()), 409, { error: 'sold_out' });

    expect(await ticketCount()).toBe(before);
  });

  it('C-F06-05 evento cancelled por fixture: compra responde 404 event_not_available', async () => {
    const cancelled = await createEvent({ organizerId: org, status: 'cancelled', capacity: 5 });
    expectJson(await apiBuy(app, cancelled.id, validBody()), 404, { error: 'event_not_available' });
    expect(await ticketCount(cancelled.id)).toBe(0);
  });
});
