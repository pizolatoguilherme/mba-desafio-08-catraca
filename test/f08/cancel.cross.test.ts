import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cancelEvent } from '../../src/cancel/service.js';
import { pool, query } from '../../src/db.js';
import { getSeatCounts, listOnSaleEvents } from '../../src/events/repo.js';
import { applyGatewayResult, type Dispatcher } from '../../src/gateway/dispatcher.js';
import { purchaseTicket } from '../../src/purchases/service.js';
import { buildApp } from '../../src/server.js';
import { createEvent, insertTicket, loginAs, resetDb } from '../helpers.js';
import {
  CARD_0001,
  CARD_0003,
  editForm,
  getPage,
  ORG_A,
  PARTICIPANT,
  postForm,
  SEED_PASSWORD,
  snapshot,
  startTestDispatcher,
  ticketStatus,
  userIdByEmail,
  waitFor,
} from './support.js';

async function buy(eventId: string, channel: 'web' | 'partner', cardNumber: string, userId?: string): Promise<{ id: string; code: string }> {
  const r = await purchaseTicket({ eventId, channel, userId, buyerEmail: `${channel}@example.com`, cardNumber });
  if (!r.ok) throw new Error(`compra recusada: ${r.error}`);
  return { id: r.ticket.id, code: r.ticket.code };
}

describe('F08 integração do cancelamento com F03, F04 e F05', () => {
  let app: FastifyInstance;
  let orgA: string;
  let cookieA: string;
  let participant: string;
  let d: Dispatcher | null = null;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    orgA = await userIdByEmail(ORG_A);
    participant = await userIdByEmail(PARTICIPANT);
    cookieA = await loginAs(app, ORG_A, SEED_PASSWORD);
  });

  afterEach(async () => {
    if (d) await d.stop();
    d = null;
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F08-09 XC-F08-F03-01 resposta atrasada do gateway não muda o ticket cancelado', async () => {
    d = startTestDispatcher(0.01);
    const ev = await createEvent({ organizerId: orgA, capacity: 5, priceCents: 5000, name: 'Atraso F08' });
    const t5 = await buy(ev.id, 'partner', CARD_0003); // aprovado em 300–400 ms (escala 0,01)
    const t6 = await buy(ev.id, 'partner', CARD_0001); // aprovado em 20–40 ms
    await waitFor(async () => (await ticketStatus(t6.id)) === 'confirmed', 5000);
    expect(await ticketStatus(t5.id)).toBe('pending');

    expect(await cancelEvent(orgA, ev.id)).toEqual({ ok: true });
    expect(await ticketStatus(t5.id)).toBe('cancelled');
    expect(await ticketStatus(t6.id)).toBe('refunded');

    // A resposta de T5 (aprovado) chega depois do cancelamento.
    await waitFor(async () => {
      const p = await query<{ state: string }>('SELECT state FROM payments WHERE ticket_id = $1', [t5.id]);
      return p.rows[0].state === 'done';
    }, 5000);
    await d.idle();

    expect(await ticketStatus(t5.id)).toBe('cancelled');
    expect(await ticketStatus(t6.id)).toBe('refunded');
    const pay = await query<{ state: string; result: string }>('SELECT state, result FROM payments WHERE ticket_id = $1', [t5.id]);
    expect(pay.rows[0]).toEqual({ state: 'done', result: 'approved' });

    expect(await applyGatewayResult(t5.id, 'approved')).toBe(false);
    expect(await ticketStatus(t5.id)).toBe('cancelled');
  });

  it('C-F08-13 XC-F08-F04-01 evento cancelado sai da vitrine, não é editado nem republicado e tem 0 vagas', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 4, priceCents: 5000, name: 'Cancelável F04', venue: 'Bar F04' });
    await insertTicket({ eventId: ev.id, status: 'confirmed' });
    await insertTicket({ eventId: ev.id, status: 'pending' });
    expect((await getPage(app, '/')).body).toContain(ev.id);

    const res = await postForm(app, `/org/events/${ev.id}/cancel`, cookieA);
    expect(res.statusCode).toBe(303);

    const home = await getPage(app, '/');
    expect(home.body).not.toContain(ev.id);
    expect(home.body).not.toContain('Cancelável F04');
    expect((await getPage(app, `/events/${ev.id}`)).statusCode).toBe(404);

    const manage = await getPage(app, `/org/events/${ev.id}`, cookieA);
    expect(manage.statusCode).toBe(200);
    expect(manage.body).not.toContain('name="capacity"');
    expect(manage.body).not.toContain(`action="/org/events/${ev.id}/publish"`);

    const before = await query('SELECT name, capacity, price_cents, status FROM events WHERE id = $1', [ev.id]);
    const edit = await postForm(app, `/org/events/${ev.id}`, cookieA, editForm({ name: 'Editado F08', capacity: '50', price: '99,00' }));
    expect(edit.statusCode).toBeLessThan(500);
    const publish = await postForm(app, `/org/events/${ev.id}/publish`, cookieA);
    expect(publish.statusCode).toBeLessThan(500);
    const after = await query('SELECT name, capacity, price_cents, status FROM events WHERE id = $1', [ev.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0]).toEqual({ name: 'Cancelável F04', capacity: 4, price_cents: 5000, status: 'cancelled' });

    expect((await getSeatCounts(pool, ev.id)).available).toBe(0);
    expect((await listOnSaleEvents()).map((e) => e.id)).not.toContain(ev.id);
  });

  it('C-F08-14 XC-F08-F05-01 compra recusada nos dois canais e Meus ingressos com estornado e cancelado', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 5, name: 'Meus F08' });
    const conf = await insertTicket({ eventId: ev.id, status: 'confirmed', userId: participant });
    const pend = await insertTicket({ eventId: ev.id, status: 'pending', userId: participant });
    expect(await cancelEvent(orgA, ev.id)).toEqual({ ok: true });

    for (const channel of ['web', 'partner'] as const) {
      const r = await purchaseTicket({
        eventId: ev.id,
        channel,
        userId: channel === 'web' ? participant : null,
        buyerEmail: 'novo@example.com',
        cardNumber: CARD_0001,
      });
      expect(r).toEqual({ ok: false, error: 'event_not_available' });
    }

    const cookieP = await loginAs(app, PARTICIPANT, SEED_PASSWORD);
    const before = await snapshot();
    const web = await postForm(app, `/events/${ev.id}/purchase`, cookieP, { cardNumber: CARD_0001 });
    expect(web.statusCode).toBe(404);
    expect(await snapshot()).toEqual(before);

    const mine = await getPage(app, '/me/tickets', cookieP);
    expect(mine.statusCode).toBe(200);
    const row = (code: string): string => mine.body.split('\n').find((l) => l.includes(`data-ticket-code="${code}"`)) ?? '';
    expect(row(conf.code)).toContain('data-ticket-status="refunded"');
    expect(row(conf.code)).toContain('>estornado<');
    expect(row(pend.code)).toContain('data-ticket-status="cancelled"');
    expect(row(pend.code)).toContain('>cancelado<');
  });
});
