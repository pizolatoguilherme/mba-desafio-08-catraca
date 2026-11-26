import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { delay, getPayment, getTicketStatus, insertPayment, waitFor } from './_support.js';

let app: FastifyInstance | null = null;
let eventId: string;

async function pendingWithPayment(last4: string): Promise<string> {
  const t = await insertTicket({ eventId });
  await insertPayment(t.id, last4); // fixture SQL, sem kick
  return t.id;
}

describe('F03 servidor', () => {
  beforeEach(async () => {
    await resetDb();
    const org = await createUser({ role: 'organizer' });
    eventId = (await createEvent({ organizerId: org.id })).id;
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('buildApp inicia o dispatcher e app.close o para', async () => {
    // Singleton de src/gateway/index.ts: escala de config (1 no gates), polling de 250 ms.
    app = await buildApp();
    await app.ready();

    const t0 = Date.now();
    const id = await pendingWithPayment('0001');
    await waitFor(async () => (await getTicketStatus(id)) === 'confirmed', 6000, 25);
    expect(Date.now() - t0).toBeLessThanOrEqual(6000);
    expect((await getPayment(id))?.state).toBe('done');

    await app.close();
    app = null;

    const after = await pendingWithPayment('0001');
    await delay(1500);
    expect((await getPayment(after))?.state).toBe('requested');
    expect(await getTicketStatus(after)).toBe('pending');
  });

  it('buildApp com startDispatcher false não inicia o dispatcher', async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();

    const id = await pendingWithPayment('0001');
    await delay(1500);
    expect((await getPayment(id))?.state).toBe('requested');
    expect(await getTicketStatus(id)).toBe('pending');
  });
});
