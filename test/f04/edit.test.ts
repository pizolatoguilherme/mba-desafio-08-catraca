import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool, query } from '../../src/db.js';
import { lockEvent } from '../../src/events/repo.js';
import { newId, newTicketCode } from '../../src/ids.js';
import { buildApp } from '../../src/server.js';
import { createEvent, insertTicket, loginAs, resetDb } from '../helpers.js';
import { eventForm, futureLocal, line, ORG_A, pastLocal, postForm, SEED_PASSWORD, settlesWithin, userId } from './_support.js';

async function eventRow(id: string) {
  return (await query('SELECT name, venue, capacity, price_cents, starts_at, updated_at FROM events WHERE id = $1', [id])).rows[0];
}

describe('F04 edição de evento', () => {
  let app: FastifyInstance;
  let cookieA: string;
  let orgA: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    cookieA = await loginAs(app, ORG_A, SEED_PASSWORD);
    orgA = await userId(ORG_A);
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F04-08 edição valida os campos como na criação', async () => {
    const ev = await createEvent({ organizerId: orgA, status: 'draft', name: 'Jazz no Porão', venue: 'Bar do Porão', capacity: 2, priceCents: 15000 });
    const before = await eventRow(ev.id);
    const cases: Array<[Record<string, string>, string, string]> = [
      [{ capacity: '0', price: '150,00' }, 'capacity', 'A lotação deve ser de pelo menos 1.'],
      [{ capacity: '2', price: '0,00' }, 'price', 'O preço deve ser maior que zero.'],
      [{ startsAt: pastLocal(), price: '150,00' }, 'startsAt', 'A data de início precisa estar no futuro.'],
      [{ name: '', price: '150,00' }, 'name', 'Informe o nome do evento.'],
      [{ venue: '' }, 'venue', 'Informe o local do evento.'],
      [{ startsAt: 'amanhã' }, 'startsAt', 'Data e hora de início inválidas.'],
      [{ capacity: '2.5' }, 'capacity', 'A lotação deve ser um número inteiro.'],
      [{ price: 'abc' }, 'price', 'Preço inválido. Use o formato 100,00.'],
    ];
    for (const [over, fieldName, message] of cases) {
      const res = await postForm(app, `/org/events/${ev.id}`, cookieA, eventForm(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(422);
      expect(res.body.split('\n').filter((l) => l.includes('data-form="edit"'))).toHaveLength(1);
      expect(line(res.body, `data-error="${fieldName}"`)).toContain(message);
      // Os valores enviados são preservados no formulário re-renderizado.
      if (over.capacity) expect(res.body).toContain(`name="capacity" value="${over.capacity}"`);
    }
    expect(await eventRow(ev.id)).toEqual(before);

    // Edição válida (data futura, preço com ponto) grava os campos.
    const startsAt = futureLocal(45);
    const ok = await postForm(app, `/org/events/${ev.id}`, cookieA, eventForm({ name: ' Jazz Editado ', venue: 'Outro Bar', startsAt, capacity: '3', price: '99.90' }));
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe(`/org/events/${ev.id}`);
    const after = (
      await query(
        `SELECT name, venue, capacity, price_cents, status, updated_at > $2 AS touched,
                to_char(starts_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') AS local
           FROM events WHERE id = $1`,
        [ev.id, before.updated_at],
      )
    ).rows[0];
    expect(after).toEqual({ name: 'Jazz Editado', venue: 'Outro Bar', capacity: 3, price_cents: 9990, status: 'draft', touched: true, local: startsAt });
  });

  it('C-F04-09 lotação abaixo das vagas ocupadas é rejeitada e igual ou acima é aceita', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 3 });
    for (const status of ['pending', 'confirmed', 'declined', 'cancelled', 'refunded'] as const) {
      await insertTicket({ eventId: ev.id, status });
    }
    const before = await eventRow(ev.id);

    const low = await postForm(app, `/org/events/${ev.id}`, cookieA, eventForm({ capacity: '1' }));
    expect(low.statusCode).toBe(422);
    expect(line(low.body, 'data-error="capacity"')).toContain('A lotação não pode ser menor que as vagas ocupadas (2).');
    expect(low.body).toContain('name="capacity" value="1"');
    expect(line(low.body, 'data-seat="capacity"')).toContain('>3<');
    expect(await eventRow(ev.id)).toEqual(before);

    const equal = await postForm(app, `/org/events/${ev.id}`, cookieA, eventForm({ capacity: '2' }));
    expect(equal.statusCode).toBe(303);
    expect((await eventRow(ev.id)).capacity).toBe(2);

    const more = await postForm(app, `/org/events/${ev.id}`, cookieA, eventForm({ capacity: '5' }));
    expect(more.statusCode).toBe(303);
    expect((await eventRow(ev.id)).capacity).toBe(5);
  });

  it('C-F04-09 edição espera o lock do evento e usa as vagas ocupadas atuais', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 3 });
    await insertTicket({ eventId: ev.id, status: 'pending' });

    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      expect((await lockEvent(holder, ev.id))?.id).toBe(ev.id);

      const edit = postForm(app, `/org/events/${ev.id}`, cookieA, eventForm({ capacity: '2' }));
      expect((await settlesWithin(edit, 500)).done).toBe(false);

      for (let i = 0; i < 2; i++) {
        await holder.query(
          `INSERT INTO tickets (id, event_id, buyer_email, channel, code, status, price_cents, card_last4)
           VALUES ($1, $2, 'lock@example.com', 'web', $3, 'pending', 10000, '0001')`,
          [newId('tkt'), ev.id, newTicketCode()],
        );
      }
      await holder.query('COMMIT');

      const res = await edit;
      expect(res.statusCode).toBe(422);
      expect(line(res.body, 'data-error="capacity"')).toContain('A lotação não pode ser menor que as vagas ocupadas (3).');
    } finally {
      holder.release();
    }
    expect((await eventRow(ev.id)).capacity).toBe(3);
  });

  it('C-F04-12 mudar o preço não altera o price_cents de ingressos existentes', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 5, priceCents: 10000 });
    await insertTicket({ eventId: ev.id, status: 'confirmed' });
    await insertTicket({ eventId: ev.id, status: 'pending' });
    const tickets = async () => (await query('SELECT id, status, price_cents, updated_at FROM tickets WHERE event_id = $1 ORDER BY id', [ev.id])).rows;
    const before = await tickets();
    expect(before.map((t) => t.price_cents)).toEqual([10000, 10000]);

    const res = await postForm(app, `/org/events/${ev.id}`, cookieA, eventForm({ capacity: '5', price: '150,00' }));
    expect(res.statusCode).toBe(303);
    expect((await eventRow(ev.id)).price_cents).toBe(15000);
    expect(await tickets()).toEqual(before);
  });
});
