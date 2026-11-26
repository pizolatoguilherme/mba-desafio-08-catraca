import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TicketStatus } from '../../src/format.js';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, insertTicket, loginAs, resetDb } from '../helpers.js';
import { CARD_0001, getPage, ORG_A, PARTICIPANT, postForm, SEED_PASSWORD, ticketRows, userIdByEmail } from './_support.js';

const LABELS: Record<TicketStatus, string> = {
  pending: 'pendente',
  confirmed: 'confirmado',
  declined: 'recusado',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

describe('F05 Meus ingressos', () => {
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

  it('C-F05-18 rótulos em português, código e nome do evento; só os do próprio participante', async () => {
    const pid = await userIdByEmail(PARTICIPANT);
    const ev = await createEvent({ organizerId: org, name: 'Jazz no <Porão>', capacity: 10 });
    const mine = new Map<string, { code: string; status: TicketStatus }>();
    for (const status of Object.keys(LABELS) as TicketStatus[]) {
      const t = await insertTicket({ eventId: ev.id, userId: pid, buyerEmail: PARTICIPANT, status });
      mine.set(t.id, { code: t.code, status });
    }
    const cookie = await loginAs(app, PARTICIPANT, SEED_PASSWORD);
    const res = await getPage(app, '/me/tickets', cookie);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<h1>Meus ingressos</h1>');
    expect(res.body).not.toContain('data-my-tickets-empty');
    const rows = ticketRows(res.body);
    expect(rows).toHaveLength(5);
    for (const [id, { code, status }] of mine) {
      const row = rows.find((r) => r.includes(`data-ticket-id="${id}"`));
      expect(row, status).toBeDefined();
      expect(row).toContain(`<tr data-ticket-id="${id}" data-ticket-code="${code}" data-ticket-status="${status}">`);
      expect(row).toContain(`<td data-col="status">${LABELS[status]}</td>`);
      expect(row).toContain(`<td data-col="code">${code}</td>`);
      // Nome do evento escapado.
      expect(row).toContain('<td data-col="event">Jazz no &lt;Porão&gt;</td>');
      expect(row).toMatch(/<\/tr>$/);
    }

    // Outro participante não vê nenhum desses códigos e, sem ingressos, vê a mensagem de vazio.
    const other = await createUser({ role: 'participant' });
    const res2 = await getPage(app, '/me/tickets', await loginAs(app, other.email, other.password));
    expect(res2.statusCode).toBe(200);
    for (const { code } of mine.values()) expect(res2.body).not.toContain(code);
    expect(res2.body).toContain('<p data-my-tickets-empty>Você ainda não tem ingressos.</p>');
    expect(ticketRows(res2.body)).toHaveLength(0);

    // Guardas: visitante -> login; organizador -> 403.
    const anon = await getPage(app, '/me/tickets');
    expect(anon.statusCode).toBe(302);
    expect(anon.headers.location).toBe(`/login?next=${encodeURIComponent('/me/tickets')}`);
    const asOrg = await getPage(app, '/me/tickets', await loginAs(app, ORG_A, SEED_PASSWORD));
    expect(asOrg.statusCode).toBe(403);

    // Link no menu para o participante logado.
    expect(res.body).toContain('href="/me/tickets"');
  });

  it('C-F05-07 ingresso partner com o mesmo e-mail do participante não aparece', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 10 });
    const partner = await insertTicket({ eventId: ev.id, channel: 'partner', userId: null, buyerEmail: PARTICIPANT });
    const cookie = await loginAs(app, PARTICIPANT, SEED_PASSWORD);

    // Uma compra pela vitrine aparece; a do parceiro, com o mesmo e-mail, não.
    const buy = await postForm(app, `/events/${ev.id}/purchase`, cookie, { cardNumber: CARD_0001 });
    expect(buy.statusCode).toBe(303);
    const res = await getPage(app, '/me/tickets', cookie);
    const rows = ticketRows(res.body);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('data-ticket-status="pending"');
    expect(rows[0]).toContain('<td data-col="status">pendente</td>');
    expect(res.body).not.toContain(partner.code);
    expect(res.body).not.toContain(partner.id);
  });
});
