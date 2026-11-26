import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPanel } from '../../src/checkin/panel.js';
import { pool } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { createEvent, insertTicket, loginAs, resetDb } from '../helpers.js';
import { getPage, ORG_A, panelMetrics, SEED_PASSWORD, userIdByEmail } from './support.js';

/** Conjunto do contrato: 3 confirmed (10000, 10000, 15000; um com check-in), 2 pending, 1 declined, 1 cancelled, 2 refunded (um com check-in). */
async function seedMix(eventId: string): Promise<void> {
  await insertTicket({ eventId, status: 'confirmed', priceCents: 10000, checkedIn: true });
  await insertTicket({ eventId, status: 'confirmed', priceCents: 10000, channel: 'partner' });
  await insertTicket({ eventId, status: 'confirmed', priceCents: 15000 });
  await insertTicket({ eventId, status: 'pending', priceCents: 15000 });
  await insertTicket({ eventId, status: 'pending', priceCents: 15000, channel: 'partner' });
  await insertTicket({ eventId, status: 'declined', priceCents: 15000 });
  await insertTicket({ eventId, status: 'cancelled', priceCents: 15000 });
  await insertTicket({ eventId, status: 'refunded', priceCents: 10000, checkedIn: true });
  await insertTicket({ eventId, status: 'refunded', priceCents: 10000, channel: 'partner' });
}

describe('F07 painel', () => {
  let app: FastifyInstance;
  let orgA: string;
  let cookieA: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    orgA = await userIdByEmail(ORG_A);
    cookieA = await loginAs(app, ORG_A, SEED_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F07-11 getPanel segue as definições de R12 com tickets dos dois canais', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 10, priceCents: 20000 });
    await seedMix(ev.id);
    expect(await getPanel(pool, ev.id)).toStrictEqual({
      confirmed: 3,
      pending: 2,
      checkins: 1,
      available: 5,
      revenueCents: 35000,
      refunded: 2,
    });

    const cancelled = await createEvent({ organizerId: orgA, capacity: 10, status: 'cancelled' });
    await seedMix(cancelled.id);
    expect(await getPanel(pool, cancelled.id)).toStrictEqual({
      confirmed: 3,
      pending: 2,
      checkins: 1,
      available: 0,
      revenueCents: 35000,
      refunded: 2,
    });

    const empty = await createEvent({ organizerId: orgA, capacity: 4 });
    expect(await getPanel(pool, empty.id)).toStrictEqual({
      confirmed: 0,
      pending: 0,
      checkins: 0,
      available: 4,
      revenueCents: 0,
      refunded: 0,
    });
  });

  it('C-F07-12 página de gestão mostra os 6 data-metric com rótulos e receita em formatBRL', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 10, name: 'Painel Misto' });
    await seedMix(ev.id);
    const res = await getPage(app, `/org/events/${ev.id}`, cookieA);
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(panelMetrics(html)).toStrictEqual({
      confirmed: '3',
      pending: '2',
      checkins: '1',
      available: '5',
      revenue: 'R$ 350,00',
      refunded: '2',
    });
    // Cada métrica contém só o valor como texto, sem tags aninhadas.
    for (const k of ['confirmed', 'pending', 'checkins', 'available', 'revenue', 'refunded']) {
      expect(html).toMatch(new RegExp(`data-metric="${k}"[^>]*>[^<]+</dd>`));
    }
    for (const label of ['Confirmados', 'Pendentes', 'Check-ins', 'Vagas disponíveis', 'Receita', 'Estornados']) {
      expect(html).toContain(`<dt>${label}</dt>`);
    }
    expect(html).toContain('data-metric="revenue">R$ 350,00<');
    expect(html).not.toContain(' ');
    expect(html).not.toContain('&nbsp;');

    const empty = await createEvent({ organizerId: orgA, capacity: 3 });
    const res2 = await getPage(app, `/org/events/${empty.id}`, cookieA);
    expect(panelMetrics(res2.body)).toStrictEqual({
      confirmed: '0',
      pending: '0',
      checkins: '0',
      available: '3',
      revenue: 'R$ 0,00',
      refunded: '0',
    });
  });
});
