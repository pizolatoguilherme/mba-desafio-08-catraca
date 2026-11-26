import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPanel } from '../../src/checkin/panel.js';
import { pool } from '../../src/db.js';
import { formatBRL } from '../../src/format.js';
import type { Dispatcher } from '../../src/gateway/dispatcher.js';
import { purchaseTicket } from '../../src/purchases/service.js';
import { buildApp } from '../../src/server.js';
import { createEvent, loginAs, resetDb } from '../helpers.js';
import { CARD_0001, getPage, ORG_A, panelMetrics, SEED_PASSWORD, startTestDispatcher, userIdByEmail, waitFor } from './support.js';

const CAPACITY = 5;
const PRICE_CENTS = 1000;
const LIMIT_MS = 10_000;

describe('F07 painel depois de uma rajada (escala 1)', () => {
  let app: FastifyInstance;
  let orgA: string;
  let cookieA: string;
  let d: Dispatcher | null = null;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    orgA = await userIdByEmail(ORG_A);
    cookieA = await loginAs(app, ORG_A, SEED_PASSWORD);
  });

  afterEach(async () => {
    if (d) await d.stop();
    d = null;
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F07-19 XC-F07-F05-03 30 compras simultâneas em lotação 5 e painel com 5 confirmados em até 10 s', { timeout: 60_000 }, async () => {
    // Dispatcher local com o gateway em escala 1 (independe do GATEWAY_DELAY_SCALE do ambiente).
    d = startTestDispatcher(1, 250);
    for (let round = 0; round < 3; round++) {
      const ev = await createEvent({ organizerId: orgA, capacity: CAPACITY, priceCents: PRICE_CENTS, name: `Rajada ${round}` });
      const t0 = Date.now();
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: `rajada-${round}-${i}@example.com`, cardNumber: CARD_0001 }),
        ),
      );
      expect(results.filter((r) => r.ok), `rodada ${round}`).toHaveLength(5);
      expect(results.filter((r) => !r.ok && r.error === 'sold_out'), `rodada ${round}`).toHaveLength(25);

      let maxOccupied = 0;
      await waitFor(async () => {
        const p = await getPanel(pool, ev.id);
        maxOccupied = Math.max(maxOccupied, p.confirmed + p.pending);
        return p.confirmed === CAPACITY && p.pending === 0;
      }, LIMIT_MS - (Date.now() - t0), 100);

      const panel = await getPanel(pool, ev.id);
      expect(panel).toMatchObject({ confirmed: 5, pending: 0, available: 0, revenueCents: 5 * PRICE_CENTS });
      const m = panelMetrics((await getPage(app, `/org/events/${ev.id}`, cookieA)).body);
      expect(m).toMatchObject({ confirmed: '5', pending: '0', available: '0', revenue: formatBRL(5 * PRICE_CENTS) });
      expect(Date.now() - t0, `rodada ${round}`).toBeLessThanOrEqual(LIMIT_MS);
      expect(maxOccupied).toBeLessThanOrEqual(CAPACITY);
    }
  });
});
