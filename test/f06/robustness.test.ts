import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, resetDb } from '../helpers.js';
import { apiBuy, CARD_0001, expectJson, ticketCount } from './_support.js';

const OK = JSON.stringify({ buyerEmail: 'x@example.com', cardNumber: CARD_0001 });

// [descrição, corpo cru, Content-Type (null = sem cabeçalho)]
const INVALID: Array<[string, string, string | null]> = [
  ['JSON malformado', '{"buyerEmail":"x@example.com",', 'application/json'],
  ['corpo vazio', '', 'application/json'],
  ['null', 'null', 'application/json'],
  ['array', '[]', 'application/json'],
  ['string', '"texto"', 'application/json'],
  ['número', '42', 'application/json'],
  ['cardNumber numérico', '{"buyerEmail":"x@example.com","cardNumber":4000000000000001}', 'application/json'],
  ['buyerEmail numérico', `{"buyerEmail":42,"cardNumber":"${CARD_0001}"}`, 'application/json'],
  ['buyerEmail ausente', `{"cardNumber":"${CARD_0001}"}`, 'application/json'],
  ['cardNumber ausente', '{"buyerEmail":"x@example.com"}', 'application/json'],
  ['cartão curto', '{"buyerEmail":"x@example.com","cardNumber":"123"}', 'application/json'],
  ['e-mail mal formado', `{"buyerEmail":"sem-arroba.example.com","cardNumber":"${CARD_0001}"}`, 'application/json'],
  ['objeto vazio', '{}', 'application/json'],
  ['Content-Type ausente', OK, null],
  ['Content-Type vazio', OK, ''],
  ['text/plain', OK, 'text/plain'],
  ['form-urlencoded', OK, 'application/x-www-form-urlencoded'],
  ['form-urlencoded de verdade', `buyerEmail=x%40example.com&cardNumber=${CARD_0001}`, 'application/x-www-form-urlencoded'],
  ['multipart', OK, 'multipart/form-data; boundary=x'],
  ['application/jsonx', OK, 'application/jsonx'],
  ['corpo de 20 KiB', JSON.stringify({ buyerEmail: 'x@example.com', cardNumber: CARD_0001, pad: 'x'.repeat(20 * 1024) }), 'application/json'],
];

describe('F06 robustez aos defaults do framework', () => {
  let app: FastifyInstance;
  let org: string;
  let open: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    org = (await createUser({ role: 'organizer' })).id;
    open = (await createEvent({ organizerId: org, capacity: 5 })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F06-06 corpos inválidos respondem 422 invalid_request e nunca 400, 415 ou 500', async () => {
    for (const [name, body, contentType] of INVALID) {
      const res = await apiBuy(app, open, body, { contentType });
      expect([name, res.statusCode]).toEqual([name, 422]);
      expectJson(res, 422, { error: 'invalid_request' });
    }
    expect(await ticketCount()).toBe(0);
    // charset é aceito no media type.
    const ok = await apiBuy(app, open, OK, { contentType: 'Application/JSON; charset=utf-8' });
    expect(ok.statusCode).toBe(202);
  });

  it('C-F06-06 ids em formato inesperado respondem 404 com o erro da rota', async () => {
    const odd = ['evt_%00', '%27%20OR%201%3D1--', 'x'.repeat(300), 'x'.repeat(500), 'EVT_ABCDEFGHIJ', 'evt_abc', 'evt_abcdefghij%20', '%20'];
    for (const id of odd) {
      const res = await apiBuy(app, id, OK);
      expect([id, res.statusCode]).toEqual([id, 404]);
      expectJson(res, 404, { error: 'event_not_available' });
    }
    expect(await ticketCount()).toBe(0);
  });
});
