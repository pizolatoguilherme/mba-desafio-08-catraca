import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { createDispatcher, type Dispatcher } from '../../src/gateway/dispatcher.js';
import { DemoUsageError, parseDemoArgs, runDemo, type DemoLine } from '../../src/gateway/enqueue-demo.js';
import { SimulatedGateway } from '../../src/gateway/simulated.js';
import { resetDb } from '../helpers.js';
import { getPayment } from './_support.js';

let d: Dispatcher | null = null;

describe('F03 enqueue-demo', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(async () => {
    if (d) await d.stop();
    d = null;
  });

  it('runDemo enfileira com enqueuePayment e reporta o status final', async () => {
    // O script não tem dispatcher próprio: o teste faz o papel do servidor.
    d = createDispatcher({ gateway: new SimulatedGateway({ scale: 0.001 }), pollMs: 50 });
    d.start();

    const seen: DemoLine[] = [];
    const lines = await runDemo({ card: '4000000000000001', count: 3, rounds: 2, wait: true, timeoutMs: 5000 }, (l) =>
      seen.push(l),
    );
    expect(lines).toHaveLength(6);
    expect(seen).toEqual(lines);
    expect(lines.map((l) => l.round)).toEqual([1, 1, 1, 2, 2, 2]);
    const eventId = lines[0].eventId;
    for (const l of lines) {
      expect(l.eventId).toBe(eventId);
      expect(l.ticketId).toMatch(/^tkt_[a-z0-9]{10}$/);
      expect(l.last4).toBe('0001');
      expect(l.status).toBe('confirmed');
      expect(l.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(l.elapsedMs).toBeLessThan(5000);
      const p = await getPayment(l.ticketId);
      expect(p?.state).toBe('done');
      expect(p?.result).toBe('approved');
      expect(p?.card_last4).toBe('0001');
    }

    const ev = await query<{ status: string; capacity: number; venue: string; email: string; name: string }>(
      `SELECT e.status, e.capacity, e.venue, e.name, u.email FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = $1`,
      [eventId],
    );
    expect(ev.rows[0]).toMatchObject({ status: 'draft', capacity: 6, venue: 'Gateway simulado', email: 'org.a@catraca.dev' });
    expect(ev.rows[0].name).toMatch(/^Demo F03 /);

    const t = await query<{ channel: string; user_id: string | null; buyer_email: string; price_cents: number }>(
      'SELECT channel, user_id, buyer_email, price_cents FROM tickets WHERE event_id = $1',
      [eventId],
    );
    expect(t.rowCount).toBe(6);
    for (const row of t.rows) {
      expect(row).toEqual({ channel: 'partner', user_id: null, buyer_email: 'demo-f03@example.com', price_cents: 1000 });
    }
  });

  it('runDemo sem espera devolve pending e deixa o pagamento requested', async () => {
    const lines = await runDemo({ card: '4000000000000004', count: 2, rounds: 1, wait: false, timeoutMs: 1000 });
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l).toMatchObject({ round: 1, last4: '0004', status: 'pending', elapsedMs: 0 });
      expect((await getPayment(l.ticketId))?.state).toBe('requested');
    }
  });

  it('runDemo reporta pending quando o timeout estoura', async () => {
    const lines = await runDemo({ card: '4000000000000001', count: 1, rounds: 1, wait: true, timeoutMs: 200 });
    expect(lines[0].status).toBe('pending');
    expect(lines[0].elapsedMs).toBeGreaterThanOrEqual(200);
  });

  it('parseDemoArgs aplica defaults e rejeita uso inválido', async () => {
    expect(parseDemoArgs([])).toEqual({ card: '4000000000000001', count: 1, rounds: 1, wait: true, timeoutMs: 10000 });
    expect(parseDemoArgs(['--card', '4000000000000003', '--count', '5', '--rounds', '10', '--no-wait', '--timeout-ms', '500'])).toEqual({
      card: '4000000000000003',
      count: 5,
      rounds: 10,
      wait: false,
      timeoutMs: 500,
    });
    expect(() => parseDemoArgs(['--card', '123'])).toThrow('cartão inválido: use 16 dígitos');
    for (const argv of [['--count', '0'], ['--count', '51'], ['--rounds', '21'], ['--rounds', 'x'], ['--bogus']]) {
      expect(() => parseDemoArgs(argv), argv.join(' ')).toThrow(DemoUsageError);
    }
    await query(`DELETE FROM users WHERE role = 'organizer'`);
    await expect(runDemo({ card: '4000000000000001', count: 1, rounds: 1, wait: false, timeoutMs: 1000 })).rejects.toThrow(
      'nenhum organizador encontrado: rode a seed',
    );
  });
});
