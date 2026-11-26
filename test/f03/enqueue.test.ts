import { beforeEach, describe, expect, it } from 'vitest';
import { pool, query, withTransaction } from '../../src/db.js';
import { enqueuePayment } from '../../src/gateway/dispatcher.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { getPayment, getTicketStatus } from './_support.js';

async function pendingTicket(): Promise<string> {
  const org = await createUser({ role: 'organizer' });
  const ev = await createEvent({ organizerId: org.id });
  const t = await insertTicket({ eventId: ev.id });
  return t.id;
}

async function countPayments(): Promise<number> {
  const r = await query<{ n: number }>('SELECT count(*)::int AS n FROM payments');
  return r.rows[0].n;
}

describe('F03 enqueuePayment', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('enqueuePayment grava requested e retorna em menos de 200 ms com 0003', async () => {
    const ticketId = await pendingTicket();
    const t0 = performance.now();
    await enqueuePayment(pool, ticketId, '0003');
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);

    const p = await getPayment(ticketId);
    expect(p).not.toBeNull();
    expect(p!.state).toBe('requested');
    expect(p!.card_last4).toBe('0003');
    expect(p!.result).toBeNull();
    expect(p!.started_at).toBeNull();
    expect(p!.completed_at).toBeNull();
    expect(await getTicketStatus(ticketId)).toBe('pending');
  });

  it('enqueuePayment participa da transação do chamador', async () => {
    const ticketId = await pendingTicket();
    await expect(
      withTransaction(async (c) => {
        await enqueuePayment(c, ticketId, '0001');
        throw new Error('falha depois do enqueue');
      }),
    ).rejects.toThrow('falha depois do enqueue');
    expect(await countPayments()).toBe(0);
    expect(await getPayment(ticketId)).toBeNull();

    await withTransaction(async (c) => {
      await enqueuePayment(c, ticketId, '0001');
    });
    const p = await getPayment(ticketId);
    expect(p?.state).toBe('requested');
    expect(await countPayments()).toBe(1);
  });

  it('enqueuePayment rejeita cardLast4 que não tem 4 dígitos', async () => {
    const ticketId = await pendingTicket();
    for (const bad of ['4000000000000001', '12a4', '123', '', '12345']) {
      await expect(enqueuePayment(pool, ticketId, bad), bad).rejects.toThrow(TypeError);
    }
    await expect(enqueuePayment(pool, ticketId, '12a4')).rejects.toThrow('cardLast4 deve ter 4 dígitos');
    expect(await countPayments()).toBe(0);
  });
});
