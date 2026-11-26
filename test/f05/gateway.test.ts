import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/db.js';
import { getSeatCounts } from '../../src/events/repo.js';
import { createDispatcher, type Dispatcher } from '../../src/gateway/dispatcher.js';
import { SimulatedGateway } from '../../src/gateway/simulated.js';
import { purchaseTicket } from '../../src/purchases/service.js';
import { createEvent, createUser, resetDb } from '../helpers.js';
import { CARD_0001, CARD_0002, ticketStatus, waitFor } from './_support.js';

describe('F05 resultado do gateway aplicado à compra (escala 0,01)', () => {
  let org: string;
  let d: Dispatcher | null = null;

  beforeEach(async () => {
    await resetDb();
    org = (await createUser({ role: 'organizer' })).id;
  });

  afterEach(async () => {
    await d?.stop();
    d = null;
  });

  it('C-F05-12 0001 vira confirmed e 0002 vira declined liberando a vaga', async () => {
    // O singleton fica parado (kick() é no-op); este dispatcher de teste pega os pagamentos por polling.
    d = createDispatcher({ gateway: new SimulatedGateway({ scale: 0.01 }), pollMs: 20 });

    const big = await createEvent({ organizerId: org, capacity: 5 });
    const one = await createEvent({ organizerId: org, capacity: 1 });

    const approved = await purchaseTicket({ eventId: big.id, channel: 'partner', buyerEmail: 'a@example.com', cardNumber: CARD_0001 });
    const declinedBig = await purchaseTicket({ eventId: big.id, channel: 'partner', buyerEmail: 'b@example.com', cardNumber: CARD_0002 });
    const declinedOne = await purchaseTicket({ eventId: one.id, channel: 'partner', buyerEmail: 'c@example.com', cardNumber: CARD_0002 });
    if (!approved.ok || !declinedBig.ok || !declinedOne.ok) throw new Error('compras deveriam ser aceitas');

    // Enquanto pendentes, ocupam vaga.
    expect(await getSeatCounts(pool, big.id)).toEqual({ capacity: 5, occupied: 2, available: 3 });
    expect(await getSeatCounts(pool, one.id)).toEqual({ capacity: 1, occupied: 1, available: 0 });
    expect(await purchaseTicket({ eventId: one.id, channel: 'partner', buyerEmail: 'd@example.com', cardNumber: CARD_0001 })).toEqual({
      ok: false,
      error: 'sold_out',
    });

    d.start();
    await waitFor(async () => {
      const s = await Promise.all([approved, declinedBig, declinedOne].map((r) => ticketStatus(r.ticket.id)));
      return s.every((x) => x !== 'pending');
    });

    expect(await ticketStatus(approved.ticket.id)).toBe('confirmed');
    expect(await ticketStatus(declinedBig.ticket.id)).toBe('declined');
    expect(await ticketStatus(declinedOne.ticket.id)).toBe('declined');
    // Confirmado continua ocupando; recusado libera a vaga.
    expect(await getSeatCounts(pool, big.id)).toEqual({ capacity: 5, occupied: 1, available: 4 });
    expect(await getSeatCounts(pool, one.id)).toEqual({ capacity: 1, occupied: 0, available: 1 });
    // A vaga liberada volta a vender.
    const again = await purchaseTicket({ eventId: one.id, channel: 'partner', buyerEmail: 'e@example.com', cardNumber: CARD_0001 });
    expect(again.ok).toBe(true);
  });
});
