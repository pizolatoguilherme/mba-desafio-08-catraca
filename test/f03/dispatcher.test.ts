import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDispatcher, type Dispatcher } from '../../src/gateway/dispatcher.js';
import { decide, SimulatedGateway, type GatewayResult, type PaymentGateway } from '../../src/gateway/simulated.js';
import { createEvent, createUser, insertTicket, resetDb } from '../helpers.js';
import { delay, getPayment, getTicketStatus, insertPayment, waitFor } from './_support.js';

const created: Dispatcher[] = [];
function make(gateway: PaymentGateway, pollMs: number): Dispatcher {
  const d = createDispatcher({ gateway, pollMs });
  created.push(d);
  return d;
}

/** Gateway falso imediato: resultado da tabela, sem atraso. */
const instant: PaymentGateway = { authorize: async (l4) => decide(l4).result };

let eventId: string;

async function pendingWithPayment(last4: string): Promise<string> {
  const t = await insertTicket({ eventId });
  await insertPayment(t.id, last4);
  return t.id;
}

describe('F03 dispatcher', () => {
  beforeEach(async () => {
    await resetDb();
    const org = await createUser({ role: 'organizer' });
    eventId = (await createEvent({ organizerId: org.id, capacity: 20 })).id;
  });

  afterEach(async () => {
    await Promise.all(created.splice(0).map((d) => d.stop()));
  });

  it('dispatcher aplica o resultado de cada final', async () => {
    const cases: Array<[string, string, GatewayResult]> = [
      ['0001', 'confirmed', 'approved'],
      ['0002', 'declined', 'declined'],
      ['0003', 'confirmed', 'approved'],
      ['0004', 'declined', 'declined'],
      ['0009', 'declined', 'declined'],
    ];
    const ids: string[] = [];
    for (const [l4] of cases) ids.push(await pendingWithPayment(l4));

    const d = make(new SimulatedGateway({ scale: 0.001 }), 50);
    d.start();
    d.kick();
    await d.idle();

    for (let i = 0; i < cases.length; i++) {
      const [l4, status, result] = cases[i];
      expect(await getTicketStatus(ids[i]), l4).toBe(status);
      const p = await getPayment(ids[i]);
      expect(p?.state, l4).toBe('done');
      expect(p?.result, l4).toBe(result);
      expect(p?.completed_at, l4).toBeInstanceOf(Date);
    }
  });

  it('dispatcher coleta por polling sem kick', async () => {
    const d = make(instant, 100);
    d.start();
    await d.idle();

    const t0 = Date.now();
    const id = await pendingWithPayment('0001'); // fixture SQL, sem kick
    await waitFor(async () => (await getPayment(id))?.state === 'done', 1000, 10);
    expect(Date.now() - t0).toBeLessThanOrEqual(1000);
    expect(await getTicketStatus(id)).toBe('confirmed');
  });

  it('kick e idle processam imediatamente', async () => {
    const d = make(instant, 60_000);
    d.start();
    await d.idle(); // primeira coleta (vazia) do start()

    const id = await pendingWithPayment('0001');
    const t0 = Date.now();
    d.kick();
    await d.idle();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(await getTicketStatus(id)).toBe('confirmed');
    expect((await getPayment(id))?.state).toBe('done');
  });

  it('kick com o dispatcher parado não processa nada', async () => {
    const d = make(instant, 50);
    const id = await pendingWithPayment('0001');
    d.kick();
    await d.idle();
    await delay(500);
    expect((await getPayment(id))?.state).toBe('requested');
    expect(await getTicketStatus(id)).toBe('pending');
  });

  it('stop interrompe a coleta', async () => {
    const pollMs = 100;
    const d = make(instant, pollMs);
    d.start();
    await d.idle();
    await d.stop();

    const id = await pendingWithPayment('0001');
    d.kick();
    await delay(4 * pollMs);
    expect((await getPayment(id))?.state).toBe('requested');
    expect(await getTicketStatus(id)).toBe('pending');

    // start() depois de stop() volta a funcionar
    d.start();
    await waitFor(async () => (await getPayment(id))?.state === 'done', 2000);
    expect(await getTicketStatus(id)).toBe('confirmed');
  });

  it('falha ao aplicar devolve o pagamento para requested', async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (r: unknown) => rejections.push(r);
    process.on('unhandledRejection', onUnhandled);
    const origError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      let calls = 0;
      const flaky: PaymentGateway = {
        authorize: async () => {
          calls++;
          // 'bogus' viola o CHECK de payments.result: a 1ª aplicação falha e faz rollback.
          return calls === 1 ? ('bogus' as GatewayResult) : 'approved';
        },
      };
      const id = await pendingWithPayment('0001');
      const d = make(flaky, 60_000);
      d.start();
      await d.idle();

      expect(calls).toBe(1);
      const after1 = await getPayment(id);
      expect(after1?.state).toBe('requested');
      expect(after1?.started_at).toBeNull();
      expect(after1?.result).toBeNull();
      expect(await getTicketStatus(id)).toBe('pending');
      expect(logged.some((a) => a[0] === '[dispatcher] falha ao aplicar resultado' && a[1] === id)).toBe(true);

      d.kick();
      await d.idle();
      expect(calls).toBe(2);
      const after2 = await getPayment(id);
      expect(after2?.state).toBe('done');
      expect(after2?.result).toBe('approved');
      expect(await getTicketStatus(id)).toBe('confirmed');

      await delay(50);
      expect(rejections).toEqual([]);
    } finally {
      console.error = origError;
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
