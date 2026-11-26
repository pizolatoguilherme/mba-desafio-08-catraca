import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDispatcher, type Dispatcher } from '../../src/gateway/dispatcher.js';
import { SimulatedGateway } from '../../src/gateway/simulated.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { getPayment, getTicketStatus, insertPayment, waitFor } from './_support.js';

let d: Dispatcher | null = null;

describe('F03 recuperação', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(async () => {
    if (d) await d.stop();
    d = null;
  });

  it('start devolve in_flight para requested e processa os pendentes', async () => {
    const org = await createUser({ role: 'organizer' });
    const ev = await createEvent({ organizerId: org.id });
    const orphan = await insertTicket({ eventId: ev.id });
    const queued = await insertTicket({ eventId: ev.id });
    // Pagamento órfão: uma app que morreu depois de coletar (state in_flight, started_at preenchido).
    await insertPayment(orphan.id, '0001', 'in_flight');
    await insertPayment(queued.id, '0003', 'requested');
    const before = await getPayment(orphan.id);
    expect(before?.state).toBe('in_flight');
    expect(before?.started_at).toBeInstanceOf(Date);

    d = createDispatcher({ gateway: new SimulatedGateway({ scale: 0.001 }), pollMs: 250 });
    const t0 = Date.now();
    d.start();

    await waitFor(
      async () => (await getPayment(orphan.id))?.state === 'done' && (await getPayment(queued.id))?.state === 'done',
      2000,
    );
    expect(Date.now() - t0).toBeLessThanOrEqual(2000);
    expect(await getTicketStatus(orphan.id)).toBe('confirmed');
    expect(await getTicketStatus(queued.id)).toBe('confirmed');
    expect((await getPayment(orphan.id))?.result).toBe('approved');
    expect((await getPayment(queued.id))?.result).toBe('approved');
  });
});
