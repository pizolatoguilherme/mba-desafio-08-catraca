import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyGatewayResult } from '../../src/gateway/dispatcher.js';
import { buildApp } from '../../src/server.js';
import { loginAs, resetDb } from '../helpers.js';
import { apiBuy, apiGet, CARD_0001, CARD_0003, expectJson, validBody } from './_support.js';

const ORG_A = 'org.a@catraca.dev';
const PARTICIPANT = 'participante@catraca.dev';
const SEED_PASSWORD = 'catraca123';
const DAY_MS = 24 * 60 * 60 * 1000;

type Item = { id: string; name: string; startsAt: string; priceCents: number; availableSeats: number };

function postForm(app: FastifyInstance, url: string, cookie: string, fields: Record<string, string>): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    payload: new URLSearchParams(fields).toString(),
  });
}

/** Linhas <tr data-ticket-id=…> de "Meus ingressos" como { id, code, status }. */
function myTicketRows(html: string): Array<{ id: string; code: string; status: string }> {
  const re = /<tr data-ticket-id="([^"]*)" data-ticket-code="([^"]*)" data-ticket-status="([^"]*)"/g;
  return [...html.matchAll(re)].map((m) => ({ id: m[1], code: m[2], status: m[3] }));
}

describe('F06 integração com F04/F05 pela UI', () => {
  let app: FastifyInstance;
  let orgCookie: string;
  let day: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    orgCookie = await loginAs(app, ORG_A, SEED_PASSWORD);
    day = new Date(Date.now() + 20 * DAY_MS).toISOString().slice(0, 10);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createViaUi(name: string, capacity: number, price: string): Promise<string> {
    const res = await postForm(app, '/org/events/new', orgCookie, {
      name,
      venue: 'Bar do Teste',
      startsAt: `${day}T20:00`,
      capacity: String(capacity),
      price,
    });
    expect(res.statusCode).toBe(303);
    const m = /^\/org\/events\/(evt_[a-z0-9]{10})$/.exec(String(res.headers.location));
    expect(m).not.toBeNull();
    return m![1];
  }

  async function publishViaUi(id: string): Promise<void> {
    const res = await postForm(app, `/org/events/${id}/publish`, orgCookie, {});
    expect(res.statusCode).toBe(303);
  }

  async function item(id: string): Promise<Item | undefined> {
    const res = await apiGet(app, '/api/partner/events');
    expect(res.statusCode).toBe(200);
    return res.json<Item[]>().find((e) => e.id === id);
  }

  it('C-F06-08 XC-F06-F04-01: evento criado pela UI só aparece depois de publicado, com preço, data e lotação da UI', async () => {
    const id = await createViaUi('Parceiro UI', 2, '100,00');
    expect(await item(id)).toBeUndefined();
    await publishViaUi(id);
    const res = await apiGet(app, '/api/partner/events');
    const found = res.json<Item[]>().find((e) => e.id === id);
    expect(found).toEqual({ id, name: 'Parceiro UI', startsAt: `${day}T20:00:00-03:00`, priceCents: 10000, availableSeats: 2 });
    // Corpo literal, com as chaves nesta ordem.
    expect(res.body).toContain(`{"id":"${id}","name":"Parceiro UI","startsAt":"${day}T20:00:00-03:00","priceCents":10000,"availableSeats":2}`);
  });

  it('C-F06-09 XC-F06-F05-01: vitrine e API disputam as mesmas vagas', async () => {
    const id = await createViaUi('Disputa UI', 2, '100,00');
    await publishViaUi(id);
    const participant = await loginAs(app, PARTICIPANT, SEED_PASSWORD);

    const web = await postForm(app, `/events/${id}/purchase`, participant, { cardNumber: CARD_0003 });
    expect(web.statusCode).toBe(303);
    expect((await item(id))?.availableSeats).toBe(1);

    const api = await apiBuy(app, id, validBody('parceiro1@example.com', CARD_0003));
    expect(api.statusCode).toBe(202);
    expect((await item(id))?.availableSeats).toBe(0);

    expectJson(await apiBuy(app, id, validBody('parceiro2@example.com', CARD_0001)), 409, { error: 'sold_out' });
    const page = await app.inject({ method: 'GET', url: `/events/${id}`, headers: { cookie: participant } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Ingressos esgotados');
    // A vitrine também vê o evento lotado.
    expect((await postForm(app, `/events/${id}/purchase`, participant, { cardNumber: CARD_0001 })).statusCode).toBe(409);
  });

  it('C-F06-09 XC-F06-F05-02: ingresso da vitrine é consultável pela API com o mesmo code e status', async () => {
    const id = await createViaUi('Consulta UI', 3, '100,00');
    await publishViaUi(id);
    const participant = await loginAs(app, PARTICIPANT, SEED_PASSWORD);
    expect((await postForm(app, `/events/${id}/purchase`, participant, { cardNumber: CARD_0003 })).statusCode).toBe(303);

    const mine = async (): Promise<Array<{ id: string; code: string; status: string }>> => {
      const res = await app.inject({ method: 'GET', url: '/me/tickets', headers: { cookie: participant } });
      expect(res.statusCode).toBe(200);
      return myTicketRows(res.body);
    };
    const [row] = await mine();
    expect(row.status).toBe('pending');
    expectJson(await apiGet(app, `/api/partner/tickets/${row.id}`), 200, {
      ticketId: row.id,
      code: row.code,
      eventId: id,
      status: 'pending',
      checkedIn: false,
    });

    // Resultado do gateway aplicado (como o dispatcher faria): os dois lados mostram confirmed.
    expect(await applyGatewayResult(row.id, 'approved')).toBe(true);
    const [after] = await mine();
    expect(after).toEqual({ id: row.id, code: row.code, status: 'confirmed' });
    expectJson(await apiGet(app, `/api/partner/tickets/${row.id}`), 200, {
      ticketId: row.id,
      code: row.code,
      eventId: id,
      status: 'confirmed',
      checkedIn: false,
    });
  });
});
