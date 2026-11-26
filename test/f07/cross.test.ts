import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPanel } from '../../src/checkin/panel.js';
import { pool, query } from '../../src/db.js';
import { getSeatCounts } from '../../src/events/repo.js';
import type { Dispatcher } from '../../src/gateway/dispatcher.js';
import { purchaseTicket } from '../../src/purchases/service.js';
import { buildApp } from '../../src/server.js';
import { createEvent, loginAs, resetDb } from '../helpers.js';
import {
  CARD_0001,
  CARD_0002,
  checkinResult,
  editForm,
  getPage,
  ORG_A,
  panelMetrics,
  PARTICIPANT,
  postForm,
  SEED_PASSWORD,
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

async function waitStatus(ticketId: string, status: string): Promise<void> {
  await waitFor(async () => (await ticketStatus(ticketId)) === status, 5000);
}

describe('F07 integração com F04 e F05', () => {
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

  it('C-F07-16 XC-F07-F04-01 Vagas disponíveis acompanha a edição de lotação de F04', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 2, priceCents: 10000, name: 'Lotação F07' });
    await buy(ev.id, 'web', CARD_0001, participant);
    await buy(ev.id, 'partner', CARD_0001);
    // Sem dispatcher: as duas compras ficam pendentes e ocupam vaga.
    expect((await getPanel(pool, ev.id)).available).toBe(0);
    expect((await getSeatCounts(pool, ev.id)).available).toBe(0);
    expect(panelMetrics((await getPage(app, `/org/events/${ev.id}`, cookieA)).body).available).toBe('0');

    const edit = await postForm(app, `/org/events/${ev.id}`, cookieA, editForm({ name: 'Lotação F07', capacity: '3', price: '100,00' }));
    expect(edit.statusCode).toBe(303);

    const panel = await getPanel(pool, ev.id);
    expect(panel.available).toBe(1);
    expect(panel.available).toBe((await getSeatCounts(pool, ev.id)).available);
    expect(panelMetrics((await getPage(app, `/org/events/${ev.id}`, cookieA)).body).available).toBe('1');
  });

  it('C-F07-17 XC-F07-F05-01 receita usa o preço de cada compra no cenário do passo 9', async () => {
    d = startTestDispatcher(0.01);
    const ev = await createEvent({ organizerId: orgA, capacity: 2, priceCents: 10000, name: 'Receita F07' });
    const t1 = await buy(ev.id, 'web', CARD_0001, participant);
    const t2 = await buy(ev.id, 'partner', CARD_0001);
    await waitStatus(t1.id, 'confirmed');
    await waitStatus(t2.id, 'confirmed');

    const edit = await postForm(app, `/org/events/${ev.id}`, cookieA, editForm({ name: 'Receita F07', capacity: '3', price: '150,00' }));
    expect(edit.statusCode).toBe(303);

    const t3 = await buy(ev.id, 'partner', CARD_0001);
    await waitStatus(t3.id, 'confirmed');

    const html = (await getPage(app, `/org/events/${ev.id}`, cookieA)).body;
    expect(panelMetrics(html)).toStrictEqual({
      confirmed: '3',
      pending: '0',
      checkins: '0',
      available: '0',
      revenue: 'R$ 350,00',
      refunded: '0',
    });
    const prices = await query<{ price_cents: number }>(
      'SELECT price_cents FROM tickets WHERE event_id = $1 ORDER BY price_cents, id',
      [ev.id],
    );
    expect(prices.rows.map((r) => r.price_cents)).toEqual([10000, 10000, 15000]);
    const channels = await query<{ channel: string }>('SELECT DISTINCT channel FROM tickets WHERE event_id = $1 ORDER BY channel', [ev.id]);
    expect(channels.rows.map((r) => r.channel)).toEqual(['partner', 'web']);
  });

  it('C-F07-18 XC-F07-F05-02 check-in aceita códigos de F05 de qualquer canal', async () => {
    d = startTestDispatcher(0.01);
    const ev = await createEvent({ organizerId: orgA, capacity: 10, name: 'Canais F07' });
    const other = await createEvent({ organizerId: orgA, capacity: 10, name: 'Outro F07' });
    const web = await buy(ev.id, 'web', CARD_0001, participant);
    const declined = await buy(ev.id, 'partner', CARD_0002);
    const otherConfirmed = await buy(other.id, 'partner', CARD_0001);
    await waitStatus(web.id, 'confirmed');
    await waitStatus(declined.id, 'declined');
    await waitStatus(otherConfirmed.id, 'confirmed');
    // Dispatcher parado: a próxima compra fica pending.
    await d.stop();
    d = null;
    const pending = await buy(ev.id, 'partner', CARD_0001);
    expect(await ticketStatus(pending.id)).toBe('pending');

    const post = async (code: string): Promise<string | null> => {
      const res = await postForm(app, `/org/events/${ev.id}/checkin`, cookieA, { code });
      expect(res.statusCode).toBe(200);
      return checkinResult(res.body);
    };
    expect(await post(web.code)).toBe('Entrada liberada');
    expect(await post(pending.code)).toBe('Ingresso não confirmado');
    expect(await post(declined.code)).toBe('Ingresso não confirmado');
    expect(await post(otherConfirmed.code)).toBe('Ingresso inválido para este evento');
  });
});
