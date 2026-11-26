import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, insertTicket, loginAs, resetDb } from '../helpers.js';
import { CARD_0001, CARD_0003, getPage, ORG_A, PARTICIPANT, postForm, SEED_PASSWORD, ticketCount, userIdByEmail } from './_support.js';

const INVALID_CARD = '<p data-purchase-error>Número do cartão inválido: informe os 16 dígitos.</p>';
const SOLD_OUT = '<p data-sold-out>Ingressos esgotados</p>';

describe('F05 compra pela vitrine', () => {
  let app: FastifyInstance;
  let org: string;
  let cookieP: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    org = (await createUser({ role: 'organizer' })).id;
    cookieP = await loginAs(app, PARTICIPANT, SEED_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F05-13 visitante é redirecionado para /login e organizador recebe 403', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 3 });
    const anon = await postForm(app, `/events/${ev.id}/purchase`, null, { cardNumber: CARD_0001 });
    expect(anon.statusCode).toBe(302);
    expect(anon.headers.location).toMatch(/^\/login\?next=/);
    expect(anon.headers.location).toBe(`/login?next=${encodeURIComponent(`/events/${ev.id}/purchase`)}`);

    const cookieOrg = await loginAs(app, ORG_A, SEED_PASSWORD);
    const asOrg = await postForm(app, `/events/${ev.id}/purchase`, cookieOrg, { cardNumber: CARD_0001 });
    expect(asOrg.statusCode).toBe(403);
    expect(await ticketCount()).toBe(0);

    // O ?next= do login (GET) volta para a página do evento.
    const back = await getPage(app, `/events/${ev.id}/purchase`);
    expect(back.statusCode).toBe(303);
    expect(back.headers.location).toBe(`/events/${ev.id}`);
  });

  it('C-F05-14 participante compra: 303 para /me/tickets em menos de 1 s, ingresso pending da sessão', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 3 });
    const t0 = performance.now();
    const res = await postForm(app, `/events/${ev.id}/purchase`, cookieP, { cardNumber: CARD_0003 });
    const elapsed = performance.now() - t0;
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/me/tickets');
    expect(elapsed).toBeLessThan(1000);

    const pid = await userIdByEmail(PARTICIPANT);
    const rows = (await query('SELECT status, channel, user_id, buyer_email, card_last4 FROM tickets WHERE event_id = $1', [ev.id])).rows;
    expect(rows).toEqual([{ status: 'pending', channel: 'web', user_id: pid, buyer_email: PARTICIPANT, card_last4: '0003' }]);
  });

  it('C-F05-15 cartão inválido: 422 com mensagem e nenhum ingresso criado', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 3, name: 'Jazz no Porão' });
    const cases: Array<Record<string, string | string[]>> = [
      { cardNumber: '123' },
      {},
      { cardNumber: [CARD_0001, CARD_0001] },
      { cardNumber: '4000 0000 0000 0001' },
    ];
    for (const fields of cases) {
      const res = await postForm(app, `/events/${ev.id}/purchase`, cookieP, fields);
      expect(res.statusCode, JSON.stringify(fields)).toBe(422);
      expect(res.body).toContain(INVALID_CARD);
      // A página do evento é re-renderizada, com o formulário para tentar de novo.
      expect(res.body).toContain('<h1 data-field="name">Jazz no Porão</h1>');
      expect(res.body).toContain('data-buy-form');
    }
    expect(await ticketCount()).toBe(0);
  });

  it('C-F05-16 evento draft, cancelled ou inexistente: 404 sem dados e nenhum ingresso', async () => {
    const draft = await createEvent({ organizerId: org, status: 'draft', name: 'Rascunho Secreto', venue: 'Porão Escondido' });
    const cancelled = await createEvent({ organizerId: org, status: 'cancelled', name: 'Cancelado Secreto', venue: 'Bar Fechado' });
    const cases: Array<[string, string[]]> = [
      [draft.id, ['Rascunho Secreto', 'Porão Escondido']],
      [cancelled.id, ['Cancelado Secreto', 'Bar Fechado']],
      ['evt_naoexiste', []],
    ];
    for (const [id, secrets] of cases) {
      for (const card of [CARD_0001, '123']) {
        const res = await postForm(app, `/events/${id}/purchase`, cookieP, { cardNumber: card });
        expect(res.statusCode, `${id} ${card}`).toBe(404);
        expect(res.body).toContain('data-error-status="404"');
        for (const s of secrets) expect(res.body).not.toContain(s);
      }
    }
    expect(await ticketCount()).toBe(0);
  });

  it('C-F05-17 sem vaga: Ingressos esgotados no lugar do formulário e POST responde 409', async () => {
    const full = await createEvent({ organizerId: org, capacity: 1, name: 'Lotado' });
    await insertTicket({ eventId: full.id, status: 'pending' });
    const open = await createEvent({ organizerId: org, capacity: 2, name: 'Com vaga' });

    const page = await getPage(app, `/events/${full.id}`, cookieP);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(SOLD_OUT);
    expect(page.body).not.toContain('data-buy-form');

    const before = await ticketCount();
    const res = await postForm(app, `/events/${full.id}/purchase`, cookieP, { cardNumber: CARD_0001 });
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('Ingressos esgotados');
    expect(res.body).toContain(SOLD_OUT);
    expect(res.body).not.toContain('data-buy-form');
    expect(await ticketCount()).toBe(before);

    const withSeat = await getPage(app, `/events/${open.id}`, cookieP);
    expect(withSeat.body).toContain('data-buy-form');
    expect(withSeat.body).toContain(`action="/events/${open.id}/purchase"`);
    expect(withSeat.body).not.toContain('data-sold-out');

    // Visitante vê o link de login; organizador vê o aviso, sem formulário.
    const anon = await getPage(app, `/events/${open.id}`);
    expect(anon.body).toContain(`<a data-buy-login href="/login?next=/events/${open.id}">Entre para comprar</a>`);
    expect(anon.body).not.toContain('data-buy-form');
    const asOrg = await getPage(app, `/events/${open.id}`, await loginAs(app, ORG_A, SEED_PASSWORD));
    expect(asOrg.body).toContain('data-buy-organizer');
    expect(asOrg.body).not.toContain('data-buy-form');
    // Esgotado aparece também para o visitante.
    expect((await getPage(app, `/events/${full.id}`)).body).toContain(SOLD_OUT);
  });
});
