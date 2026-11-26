import { beforeEach, describe, expect, it } from 'vitest';
import { pool, withTransaction } from '../../src/db.js';
import {
  createOwnedEvent,
  getOwnedEvent,
  getPublicEvent,
  getSeatCounts,
  listOnSaleEvents,
  listOwnedEvents,
  lockEvent,
} from '../../src/events/repo.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { settlesWithin } from './_support.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('F04 repositório', () => {
  let orgA: string;
  let orgB: string;

  beforeEach(async () => {
    await resetDb();
    orgA = (await createUser({ role: 'organizer' })).id;
    orgB = (await createUser({ role: 'organizer' })).id;
  });

  it('C-F04-11 getSeatCounts conta pending e confirmed e zera em evento cancelado', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 5 });
    for (const status of ['pending', 'confirmed', 'declined', 'cancelled', 'refunded'] as const) {
      await insertTicket({ eventId: ev.id, status });
    }
    await insertTicket({ eventId: ev.id, status: 'confirmed', checkedIn: true });
    expect(await getSeatCounts(pool, ev.id)).toEqual({ capacity: 5, occupied: 3, available: 2 });

    const cancelled = await createEvent({ organizerId: orgA, status: 'cancelled', capacity: 5 });
    await insertTicket({ eventId: cancelled.id, status: 'pending' });
    expect(await getSeatCounts(pool, cancelled.id)).toEqual({ capacity: 5, occupied: 1, available: 0 });

    const over = await createEvent({ organizerId: orgA, capacity: 1 });
    await insertTicket({ eventId: over.id, status: 'confirmed' });
    await insertTicket({ eventId: over.id, status: 'confirmed' });
    expect(await getSeatCounts(pool, over.id)).toEqual({ capacity: 1, occupied: 2, available: 0 });

    const empty = await createEvent({ organizerId: orgA, capacity: 4, status: 'draft' });
    expect(await getSeatCounts(pool, empty.id)).toEqual({ capacity: 4, occupied: 0, available: 4 });

    expect(await getSeatCounts(pool, 'evt_naoexiste')).toEqual({ capacity: 0, occupied: 0, available: 0 });

    // Também funciona dentro de uma transação (client).
    const inTx = await withTransaction((c) => getSeatCounts(c, ev.id));
    expect(inTx).toEqual({ capacity: 5, occupied: 3, available: 2 });
  });

  it('C-F04-18 listOnSaleEvents devolve só published com available', async () => {
    const now = Date.now();
    await createEvent({ organizerId: orgA, status: 'draft', startsAt: new Date(now + 5 * DAY_MS) });
    await createEvent({ organizerId: orgA, status: 'cancelled', startsAt: new Date(now + 6 * DAY_MS) });
    const later = await createEvent({ organizerId: orgA, capacity: 4, startsAt: new Date(now + 20 * DAY_MS), priceCents: 5000 });
    const sooner = await createEvent({ organizerId: orgB, capacity: 3, startsAt: new Date(now + 10 * DAY_MS) });
    await insertTicket({ eventId: later.id, status: 'pending' });
    await insertTicket({ eventId: later.id, status: 'confirmed' });
    await insertTicket({ eventId: later.id, status: 'declined' });
    await insertTicket({ eventId: sooner.id, status: 'refunded' });

    const list = await listOnSaleEvents();
    expect(list.map((e) => e.id)).toEqual([sooner.id, later.id]);
    expect(list.map((e) => e.available)).toEqual([3, 2]);
    expect(list.every((e) => e.status === 'published')).toBe(true);
    expect(list[1]).toMatchObject({ capacity: 4, price_cents: 5000, organizer_id: orgA, name: 'Evento Teste', venue: 'Local Teste' });
    expect(list[1].starts_at).toBeInstanceOf(Date);

    // Aceita um Db explícito (client de transação).
    const viaClient = await withTransaction((c) => listOnSaleEvents(c));
    expect(viaClient.map((e) => e.id)).toEqual([sooner.id, later.id]);
  });

  it('C-F04-18 getOwnedEvent e getPublicEvent filtram dono e status', async () => {
    const pub = await createEvent({ organizerId: orgA });
    const draft = await createEvent({ organizerId: orgA, status: 'draft' });
    const cancelled = await createEvent({ organizerId: orgA, status: 'cancelled' });

    expect((await getOwnedEvent(orgA, pub.id))?.id).toBe(pub.id);
    expect((await getOwnedEvent(orgA, draft.id))?.status).toBe('draft');
    expect((await getOwnedEvent(orgA, cancelled.id))?.status).toBe('cancelled');
    expect(await getOwnedEvent(orgB, pub.id)).toBeNull();
    expect(await getOwnedEvent(orgA, 'evt_naoexiste')).toBeNull();

    expect((await getPublicEvent(pub.id))?.id).toBe(pub.id);
    expect(await getPublicEvent(draft.id)).toBeNull();
    expect(await getPublicEvent(cancelled.id)).toBeNull();
    expect(await getPublicEvent('evt_naoexiste')).toBeNull();

    const owned = await listOwnedEvents(orgA);
    expect(owned.map((e) => e.id).sort()).toEqual([pub.id, draft.id, cancelled.id].sort());
    expect(await listOwnedEvents(orgB)).toEqual([]);

    const created = await createOwnedEvent(orgB, {
      name: 'Novo',
      venue: 'Sala',
      startsAt: new Date(Date.now() + DAY_MS),
      capacity: 2,
      priceCents: 1000,
    });
    expect(created).toMatchObject({ organizer_id: orgB, status: 'draft', capacity: 2, price_cents: 1000 });
    expect(created.id).toMatch(/^evt_[a-z0-9]{10}$/);
  });

  it('C-F04-18 lockEvent bloqueia uma segunda transação até o commit', async () => {
    const ev = await createEvent({ organizerId: orgA });
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const locked = await lockEvent(holder, ev.id);
      expect(locked?.id).toBe(ev.id);

      const second = withTransaction((c) => lockEvent(c, ev.id));
      expect((await settlesWithin(second, 500)).done).toBe(false);

      await holder.query('COMMIT');
      const after = await settlesWithin(second, 5000);
      expect(after.done).toBe(true);
      expect(after.done && after.value?.id).toBe(ev.id);
    } finally {
      holder.release();
    }

    expect(await withTransaction((c) => lockEvent(c, 'evt_naoexiste'))).toBeNull();
  });
});
