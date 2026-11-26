import { scryptSync, timingSafeEqual } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('C-F01-19 helpers', () => {
  beforeEach(resetDb);

  it('resetDb limpa as tabelas e recarrega a seed', async () => {
    const org = await createUser({ role: 'organizer' });
    const ev = await createEvent({ organizerId: org.id });
    const t = await insertTicket({ eventId: ev.id });
    await query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', $1, now() + interval '1 day')`, [org.id]);
    await query(`INSERT INTO payments (ticket_id, card_last4) VALUES ($1, '0001')`, [t.id]);

    await resetDb();

    const counts = await query<{ t: string; n: number }>(
      `SELECT 'events' AS t, count(*)::int AS n FROM events
       UNION ALL SELECT 'tickets', count(*)::int FROM tickets
       UNION ALL SELECT 'payments', count(*)::int FROM payments
       UNION ALL SELECT 'sessions', count(*)::int FROM sessions
       UNION ALL SELECT 'users', count(*)::int FROM users`,
    );
    expect(Object.fromEntries(counts.rows.map((r) => [r.t, r.n]))).toEqual({
      events: 0,
      tickets: 0,
      payments: 0,
      sessions: 0,
      users: 3,
    });
    const emails = await query<{ email: string }>('SELECT email FROM users ORDER BY email');
    expect(emails.rows.map((r) => r.email)).toEqual([
      'org.a@catraca.dev',
      'org.b@catraca.dev',
      'participante@catraca.dev',
    ]);
    // RESTART IDENTITY: a sequência de payments volta a 1
    await query(`INSERT INTO users (id, name, email, password_hash, role) VALUES ('usr_x', 'X', 'x@x.com', 'x', 'organizer')`);
    await query(`INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents)
                 VALUES ('evt_x', 'usr_x', 'E', 'L', now(), 1, 1)`);
    await query(`INSERT INTO tickets (id, event_id, buyer_email, channel, code, price_cents, card_last4)
                 VALUES ('tkt_x', 'evt_x', 'a@a.com', 'web', 'ABCDEFGH', 1, '0001')`);
    const p = await query<{ id: string }>(`INSERT INTO payments (ticket_id, card_last4) VALUES ('tkt_x', '0001') RETURNING id`);
    expect(p.rows[0].id).toBe('1');
  });

  it('createUser grava usuário com hash e devolve a senha em texto', async () => {
    const u = await createUser({ role: 'participant' });
    expect(u.id).toMatch(/^usr_[a-z0-9]{10}$/);
    expect(u.email).toMatch(/^u-[a-z0-9]{10}@example\.com$/);
    expect(u.password).toBe('senha123');
    const row = await query<{ name: string; role: string; password_hash: string }>(
      'SELECT name, role, password_hash FROM users WHERE id = $1',
      [u.id],
    );
    expect(row.rows[0].name).toBe('Usuário Teste');
    expect(row.rows[0].role).toBe('participant');
    const [, salt, hash] = row.rows[0].password_hash.split('$');
    const key = scryptSync('senha123', Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    expect(timingSafeEqual(key, Buffer.from(hash, 'hex'))).toBe(true);

    const o = await createUser({ role: 'organizer', email: 'Org.Z@example.com', password: 'outra', name: 'Org Z' });
    expect(o).toMatchObject({ email: 'Org.Z@example.com', password: 'outra' });
    const orow = await query<{ name: string; role: string }>('SELECT name, role FROM users WHERE id = $1', [o.id]);
    expect(orow.rows[0]).toEqual({ name: 'Org Z', role: 'organizer' });
  });

  it('createEvent aplica os defaults e respeita o status', async () => {
    const org = await createUser({ role: 'organizer' });
    const before = Date.now();
    const def = await createEvent({ organizerId: org.id });
    expect(def.id).toMatch(/^evt_[a-z0-9]{10}$/);
    const r = await query<{
      name: string; venue: string; capacity: number; price_cents: number; status: string;
      starts_at: Date; published_at: Date | null; cancelled_at: Date | null; organizer_id: string;
    }>('SELECT * FROM events WHERE id = $1', [def.id]);
    const e = r.rows[0];
    expect(e).toMatchObject({
      organizer_id: org.id, name: 'Evento Teste', venue: 'Local Teste', capacity: 10, price_cents: 10000,
      status: 'published', cancelled_at: null,
    });
    expect(e.published_at).toBeInstanceOf(Date);
    const delta = e.starts_at.getTime() - before;
    expect(delta).toBeGreaterThan(30 * DAY_MS - 60_000);
    expect(delta).toBeLessThan(30 * DAY_MS + 60_000);

    const startsAt = new Date('2027-01-10T23:00:00Z');
    const draft = await createEvent({
      organizerId: org.id, status: 'draft', capacity: 5, priceCents: 1000, startsAt, name: 'Show', venue: 'Bar',
    });
    const d = (await query('SELECT * FROM events WHERE id = $1', [draft.id])).rows[0];
    expect(d).toMatchObject({ status: 'draft', capacity: 5, price_cents: 1000, name: 'Show', venue: 'Bar',
      published_at: null, cancelled_at: null });
    expect(d.starts_at.toISOString()).toBe(startsAt.toISOString());

    const cancelled = await createEvent({ organizerId: org.id, status: 'cancelled' });
    const c = (await query('SELECT * FROM events WHERE id = $1', [cancelled.id])).rows[0];
    expect(c.status).toBe('cancelled');
    expect(c.published_at).toBeInstanceOf(Date);
    expect(c.cancelled_at).toBeInstanceOf(Date);
  });

  it('insertTicket usa o preço do evento e gera código', async () => {
    const org = await createUser({ role: 'organizer' });
    const buyer = await createUser({ role: 'participant' });
    const ev = await createEvent({ organizerId: org.id, priceCents: 35000 });

    const t = await insertTicket({ eventId: ev.id });
    expect(t.id).toMatch(/^tkt_[a-z0-9]{10}$/);
    expect(t.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const row = (await query('SELECT * FROM tickets WHERE id = $1', [t.id])).rows[0];
    expect(row).toMatchObject({
      event_id: ev.id, code: t.code, status: 'pending', price_cents: 35000, channel: 'web', user_id: null,
      buyer_email: 'comprador@example.com', card_last4: '0001', checked_in_at: null,
    });

    // o preço gravado é o vigente na inserção: mudar o evento depois não altera o ingresso
    await query('UPDATE events SET price_cents = 50000 WHERE id = $1', [ev.id]);
    const t2 = await insertTicket({
      eventId: ev.id, status: 'confirmed', channel: 'partner', buyerEmail: 'p@example.com', code: 'ABCD2345', checkedIn: true,
    });
    expect(t2.code).toBe('ABCD2345');
    const t3 = await insertTicket({ eventId: ev.id, userId: buyer.id, priceCents: 1234 });
    const rows = (await query('SELECT * FROM tickets ORDER BY created_at, id')).rows;
    const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
    expect(byId[t.id].price_cents).toBe(35000);
    expect(byId[t2.id]).toMatchObject({ price_cents: 50000, status: 'confirmed', channel: 'partner', buyer_email: 'p@example.com' });
    expect(byId[t2.id].checked_in_at).toBeInstanceOf(Date);
    expect(byId[t3.id]).toMatchObject({ price_cents: 1234, user_id: buyer.id, channel: 'web' });
    expect((await query('SELECT 1 FROM payments')).rowCount).toBe(0);
  });
});
