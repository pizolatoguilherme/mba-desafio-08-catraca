import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool, query, withTransaction } from '../../src/db.js';
import { getSeatCounts } from '../../src/events/repo.js';
import { dispatcher } from '../../src/gateway/index.js';
import { newId } from '../../src/ids.js';
import * as service from '../../src/purchases/service.js';
import {
  findTicketByCode,
  findTicketById,
  insertTicketWithUniqueCode,
  listTicketsForUser,
  purchaseTicket,
} from '../../src/purchases/service.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { CARD_0001, ticketCount } from './_support.js';

const EMAIL = 'ana@example.com';

let org: string;

beforeEach(async () => {
  await resetDb();
  org = (await createUser({ role: 'organizer' })).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('F05 serviço de compras', () => {
  it('C-F05-08 módulo de compras exporta a interface do architecture.md', () => {
    for (const name of [
      'purchaseTicket',
      'validatePurchaseInput',
      'findTicketById',
      'findTicketByCode',
      'listTicketsForUser',
      'insertTicketWithUniqueCode',
    ] as const) {
      expect(typeof service[name], name).toBe('function');
    }
  });

  it('C-F05-03 ordem dos erros: invalid_request, event_not_available, sold_out', async () => {
    const before = await ticketCount();
    // Cartão inválido em evento inexistente -> invalid_request (validação vem antes do evento).
    expect(await purchaseTicket({ eventId: 'evt_naoexiste', channel: 'partner', buyerEmail: EMAIL, cardNumber: '123' })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
    expect(await purchaseTicket({ eventId: 'evt_naoexiste', channel: 'partner', buyerEmail: 'x', cardNumber: CARD_0001 })).toEqual({
      ok: false,
      error: 'invalid_request',
    });

    // Corpo válido em evento inexistente, draft e cancelled (mesmo lotados) -> event_not_available.
    const draft = await createEvent({ organizerId: org, status: 'draft', capacity: 1 });
    const cancelled = await createEvent({ organizerId: org, status: 'cancelled', capacity: 1 });
    await insertTicket({ eventId: draft.id, status: 'confirmed' });
    await insertTicket({ eventId: cancelled.id, status: 'pending' });
    const afterFixtures = await ticketCount();
    for (const eventId of ['evt_naoexiste', draft.id, cancelled.id]) {
      expect(await purchaseTicket({ eventId, channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 }), eventId).toEqual({
        ok: false,
        error: 'event_not_available',
      });
    }
    expect(await ticketCount()).toBe(afterFixtures);

    // Publicado e lotado -> sold_out.
    const full = await createEvent({ organizerId: org, capacity: 1 });
    await insertTicket({ eventId: full.id, status: 'confirmed' });
    expect(await purchaseTicket({ eventId: full.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 })).toEqual({
      ok: false,
      error: 'sold_out',
    });
    // Lotado com cartão inválido continua invalid_request.
    expect(await purchaseTicket({ eventId: full.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: '1' })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
    expect(await ticketCount()).toBe(afterFixtures + 1);
    expect(before).toBe(0);
  });

  it('C-F05-04 compra cria ingresso pending com price_cents do evento e pagamento requested', async () => {
    const ev = await createEvent({ organizerId: org, priceCents: 10000, capacity: 2 });
    const buyer = await createUser({ role: 'participant' });
    const r = await purchaseTicket({ eventId: ev.id, channel: 'web', userId: buyer.id, buyerEmail: buyer.email, cardNumber: CARD_0001 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.status).toBe('pending');
    expect(r.ticket.eventId).toBe(ev.id);
    expect(r.ticket.id).toMatch(/^tkt_[a-z0-9]{10}$/);
    expect(r.ticket.code).toMatch(/^[A-Z2-9]{8}$/);

    const t = await findTicketById(r.ticket.id);
    expect(t).toMatchObject({
      id: r.ticket.id,
      event_id: ev.id,
      user_id: buyer.id,
      buyer_email: buyer.email,
      channel: 'web',
      code: r.ticket.code,
      status: 'pending',
      price_cents: 10000,
      card_last4: '0001',
      checked_in_at: null,
    });
    const p = await query('SELECT ticket_id, card_last4, state, result FROM payments WHERE ticket_id = $1', [r.ticket.id]);
    expect(p.rows).toEqual([{ ticket_id: r.ticket.id, card_last4: '0001', state: 'requested', result: null }]);
    // O número completo do cartão nunca é gravado.
    const leak = await query("SELECT count(*)::int AS n FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE (t.*)::text LIKE '%4000000000000001%' OR (p.*)::text LIKE '%4000000000000001%'");
    expect(leak.rows[0].n).toBe(0);
  });

  it('C-F05-04 mudança de preço posterior não altera o price_cents do ingresso', async () => {
    const ev = await createEvent({ organizerId: org, priceCents: 10000, capacity: 5 });
    const a = await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 });
    await query('UPDATE events SET price_cents = 15000 WHERE id = $1', [ev.id]);
    const b = await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect((await findTicketById(a.ticket.id))?.price_cents).toBe(10000);
    expect((await findTicketById(b.ticket.id))?.price_cents).toBe(15000);
  });

  it('C-F05-05 ingresso pendente ocupa vaga', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 1 });
    expect((await getSeatCounts(pool, ev.id)).available).toBe(1);
    const r = await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 });
    expect(r.ok).toBe(true);
    expect(await getSeatCounts(pool, ev.id)).toEqual({ capacity: 1, occupied: 1, available: 0 });
    expect(await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 })).toEqual({
      ok: false,
      error: 'sold_out',
    });
    expect(await ticketCount(ev.id)).toBe(1);
  });

  it('C-F05-06 código de 8 caracteres do alfabeto A-Z2-9 e nova tentativa em colisão', async () => {
    const ev = await createEvent({ organizerId: org });
    await insertTicket({ eventId: ev.id, code: 'AAAAAAAA' });

    const codes = ['AAAAAAAA', 'BBBBBBBB'];
    const gen = vi.fn(() => codes.shift()!);
    const res = await withTransaction((c) =>
      insertTicketWithUniqueCode(
        c,
        { id: newId('tkt'), event_id: ev.id, user_id: null, buyer_email: EMAIL, channel: 'partner', price_cents: 10000, card_last4: '0001' },
        gen,
      ),
    );
    expect(res.code).toBe('BBBBBBBB');
    expect(gen).toHaveBeenCalledTimes(2);
    expect((await findTicketById(res.id))?.code).toBe('BBBBBBBB');

    // Sempre colidindo: depois de 5 tentativas, erro (e rollback: nada gravado).
    const always = vi.fn(() => 'AAAAAAAA');
    await expect(
      withTransaction((c) =>
        insertTicketWithUniqueCode(
          c,
          { id: newId('tkt'), event_id: ev.id, user_id: null, buyer_email: EMAIL, channel: 'partner', price_cents: 10000, card_last4: '0001' },
          always,
        ),
      ),
    ).rejects.toThrow();
    expect(always).toHaveBeenCalledTimes(5);
    expect(await ticketCount(ev.id)).toBe(2);

    // Gerador real (newTicketCode).
    const real = await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 });
    expect(real.ok && real.ticket.code).toMatch(/^[A-Z2-9]{8}$/);
  });

  it('C-F05-07 canal partner sem userId conta na lotação', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 2 });
    const r = await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: 'parceiro@example.com', cardNumber: CARD_0001 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = await findTicketById(r.ticket.id);
    expect(t).toMatchObject({ user_id: null, channel: 'partner', buyer_email: 'parceiro@example.com', status: 'pending' });
    expect(await getSeatCounts(pool, ev.id)).toEqual({ capacity: 2, occupied: 1, available: 1 });
  });

  it('C-F05-08 kick do dispatcher é chamado só em sucesso e depois do commit', async () => {
    const ev = await createEvent({ organizerId: org, capacity: 1 });
    const seen: Array<Promise<number>> = [];
    const spy = vi.spyOn(dispatcher, 'kick').mockImplementation(() => {
      // Outra conexão do pool: só enxerga o ingresso se a transação da compra já fez COMMIT.
      seen.push(
        query<{ n: number }>("SELECT count(*)::int AS n FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.event_id = $1", [ev.id]).then(
          (r) => r.rows[0].n,
        ),
      );
    });

    const ok = await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 });
    expect(ok.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await seen[0]).toBe(1);

    // Erros não chamam kick.
    await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 }); // sold_out
    await purchaseTicket({ eventId: ev.id, channel: 'partner', buyerEmail: EMAIL, cardNumber: '123' }); // invalid_request
    await purchaseTicket({ eventId: 'evt_naoexiste', channel: 'partner', buyerEmail: EMAIL, cardNumber: CARD_0001 }); // event_not_available
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('findTicketById, findTicketByCode e listTicketsForUser', async () => {
    const ev1 = await createEvent({ organizerId: org, name: 'Jazz no Porão' });
    const ev2 = await createEvent({ organizerId: org, name: 'Rock na Garagem' });
    const u1 = await createUser({ role: 'participant' });
    const u2 = await createUser({ role: 'participant' });
    const a = await insertTicket({ eventId: ev1.id, userId: u1.id, code: 'K7Q2M9XA' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await insertTicket({ eventId: ev2.id, userId: u1.id, status: 'confirmed' });
    await insertTicket({ eventId: ev1.id, userId: u2.id });
    await insertTicket({ eventId: ev1.id, userId: null, channel: 'partner', buyerEmail: u1.email });

    expect(await findTicketById('tkt_naoexiste')).toBeNull();
    expect((await findTicketById(a.id))?.code).toBe('K7Q2M9XA');
    expect(await findTicketByCode('ZZZZZZZZ')).toBeNull();
    expect((await findTicketByCode('  k7q2m9xa '))?.id).toBe(a.id);

    const list = await listTicketsForUser(u1.id);
    expect(list.map((t) => t.id)).toEqual([b.id, a.id]);
    expect(list.map((t) => t.event_name)).toEqual(['Rock na Garagem', 'Jazz no Porão']);
    expect(list.every((t) => t.user_id === u1.id)).toBe(true);
    expect(await listTicketsForUser('usr_ninguem')).toEqual([]);
  });
});
