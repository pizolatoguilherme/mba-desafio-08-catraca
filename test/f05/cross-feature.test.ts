import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { createEvent, loginAs, resetDb } from '../helpers.js';
import { CARD_0003, ORG_A, PARTICIPANT, postForm, SEED_PASSWORD, userIdByEmail } from './_support.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function editForm(capacity: string): Record<string, string> {
  return {
    name: 'Lotação Cruzada',
    venue: 'Bar do Teste',
    startsAt: new Date(Date.now() + 20 * DAY_MS).toISOString().slice(0, 10) + 'T20:00',
    capacity,
    price: '100,00',
  };
}

async function capacityOf(id: string): Promise<number> {
  return (await query<{ capacity: number }>('SELECT capacity FROM events WHERE id = $1', [id])).rows[0].capacity;
}

describe('F05 integração com F04', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F05-19 XC-F05-F04-01: pendentes contam na redução de lotação da edição de F04', async () => {
    const orgA = await userIdByEmail(ORG_A);
    const ev = await createEvent({ organizerId: orgA, capacity: 2, priceCents: 10000, name: 'Lotação Cruzada' });
    const cookieP = await loginAs(app, PARTICIPANT, SEED_PASSWORD);
    const cookieA = await loginAs(app, ORG_A, SEED_PASSWORD);

    for (let i = 0; i < 2; i++) {
      const r = await postForm(app, `/events/${ev.id}/purchase`, cookieP, { cardNumber: CARD_0003 });
      expect(r.statusCode).toBe(303);
    }
    const pending = await query<{ n: number }>("SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND status = 'pending'", [ev.id]);
    expect(pending.rows[0].n).toBe(2);

    const down = await postForm(app, `/org/events/${ev.id}`, cookieA, editForm('1'));
    expect(down.statusCode).toBe(422);
    expect(await capacityOf(ev.id)).toBe(2);
    expect((await postForm(app, `/events/${ev.id}/purchase`, cookieP, { cardNumber: CARD_0003 })).statusCode).toBe(409);

    const up = await postForm(app, `/org/events/${ev.id}`, cookieA, editForm('3'));
    expect(up.statusCode).toBe(303);
    expect(await capacityOf(ev.id)).toBe(3);

    const again = await postForm(app, `/events/${ev.id}/purchase`, cookieP, { cardNumber: CARD_0003 });
    expect(again.statusCode).toBe(303);
    expect(again.headers.location).toBe('/me/tickets');
  });
});
