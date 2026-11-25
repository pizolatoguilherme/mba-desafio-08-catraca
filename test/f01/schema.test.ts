import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';

interface PgError {
  code?: string;
  constraint?: string;
  column?: string;
}

async function pgError(p: Promise<unknown>): Promise<PgError> {
  try {
    await p;
  } catch (err) {
    return err as PgError;
  }
  throw new Error('era esperado um erro do Postgres');
}

const ORG = 'usr_schemaorg0';
const EVT = 'evt_schemaevt0';
const TKT = 'tkt_schematkt0';

describe('C-F01-08 schema', () => {
  beforeEach(async () => {
    await query('TRUNCATE users, sessions, events, tickets, payments RESTART IDENTITY CASCADE');
    await query(
      `INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, 'Org', 'schema-org@example.com', 'x', 'organizer')`,
      [ORG],
    );
    await query(
      `INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents)
       VALUES ($1, $2, 'Evento', 'Local', now() + interval '7 days', 5, 1000)`,
      [EVT, ORG],
    );
    await query(
      `INSERT INTO tickets (id, event_id, buyer_email, channel, code, price_cents, card_last4)
       VALUES ($1, $2, 'a@example.com', 'partner', 'SCHM2345', 1000, '0001')`,
      [TKT, EVT],
    );
  });

  it('rejeita events.capacity menor que 1', async () => {
    for (const v of [0, -1]) {
      const e = await pgError(query('UPDATE events SET capacity = $1 WHERE id = $2', [v, EVT]));
      expect(e.code).toBe('23514');
      expect(e.constraint).toBe('events_capacity_check');
    }
    await query('UPDATE events SET capacity = 1 WHERE id = $1', [EVT]);
  });

  it('rejeita events.price_cents menor ou igual a 0', async () => {
    for (const v of [0, -100]) {
      const e = await pgError(query('UPDATE events SET price_cents = $1 WHERE id = $2', [v, EVT]));
      expect(e.code).toBe('23514');
      expect(e.constraint).toBe('events_price_cents_check');
    }
  });

  it('rejeita events.status fora de draft/published/cancelled', async () => {
    const def = await query<{ status: string }>('SELECT status FROM events WHERE id = $1', [EVT]);
    expect(def.rows[0].status).toBe('draft');
    const e = await pgError(query(`UPDATE events SET status = 'archived' WHERE id = $1`, [EVT]));
    expect(e.code).toBe('23514');
    expect(e.constraint).toBe('events_status_check');
    for (const s of ['published', 'cancelled', 'draft']) {
      await query('UPDATE events SET status = $1 WHERE id = $2', [s, EVT]);
    }
  });

  it('rejeita tickets.code duplicado', async () => {
    const e = await pgError(
      query(
        `INSERT INTO tickets (id, event_id, buyer_email, channel, code, price_cents, card_last4)
         VALUES ('tkt_schematkt1', $1, 'b@example.com', 'partner', 'SCHM2345', 1000, '0001')`,
        [EVT],
      ),
    );
    expect(e.code).toBe('23505');
    expect(e.constraint).toBe('tickets_code_key');
  });

  it('rejeita tickets.status fora dos cinco valores', async () => {
    const def = await query<{ status: string }>('SELECT status FROM tickets WHERE id = $1', [TKT]);
    expect(def.rows[0].status).toBe('pending');
    const e = await pgError(query(`UPDATE tickets SET status = 'used' WHERE id = $1`, [TKT]));
    expect(e.code).toBe('23514');
    expect(e.constraint).toBe('tickets_status_check');
    for (const s of ['confirmed', 'declined', 'cancelled', 'refunded', 'pending']) {
      await query('UPDATE tickets SET status = $1 WHERE id = $2', [s, TKT]);
    }
  });

  it('exige tickets.price_cents positivo por ingresso', async () => {
    const zero = await pgError(query('UPDATE tickets SET price_cents = 0 WHERE id = $1', [TKT]));
    expect(zero.code).toBe('23514');
    expect(zero.constraint).toBe('tickets_price_cents_check');
    const missing = await pgError(
      query(
        `INSERT INTO tickets (id, event_id, buyer_email, channel, code, card_last4)
         VALUES ('tkt_schematkt2', $1, 'c@example.com', 'partner', 'SCHM2346', '0001')`,
        [EVT],
      ),
    );
    expect(missing.code).toBe('23502');
    expect(missing.column).toBe('price_cents');
    // o preço do ingresso é independente do preço atual do evento
    await query('UPDATE events SET price_cents = 2000 WHERE id = $1', [EVT]);
    const t = await query<{ price_cents: number }>('SELECT price_cents FROM tickets WHERE id = $1', [TKT]);
    expect(t.rows[0].price_cents).toBe(1000);
  });

  it('users.email é único sem diferenciar maiúsculas', async () => {
    const e = await pgError(
      query(
        `INSERT INTO users (id, name, email, password_hash, role)
         VALUES ('usr_schemadup0', 'Dup', 'Schema-ORG@Example.com', 'x', 'participant')`,
      ),
    );
    expect(e.code).toBe('23505');
    expect(e.constraint).toBe('users_email_lower_uq');
  });
});
