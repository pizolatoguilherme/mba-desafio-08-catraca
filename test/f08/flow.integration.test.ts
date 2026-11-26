import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFlow } from '../../scripts/flow/evaluator-flow.mjs';
import { config } from '../../src/config.js';
import type { Dispatcher } from '../../src/gateway/dispatcher.js';
import { buildApp } from '../../src/server.js';
import { resetDb } from '../helpers.js';
import { startTestDispatcher } from './support.js';

const SCALE = 0.1;

describe('F08 fluxo do avaliador em escala reduzida', () => {
  let app: FastifyInstance;
  let d: Dispatcher;
  let web: string;

  beforeAll(async () => {
    await resetDb();
    app = await buildApp({ startDispatcher: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    web = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    // Dispatcher local na mesma escala do fluxo (o singleton do app fica parado).
    d = startTestDispatcher(SCALE, 50);
  });

  afterAll(async () => {
    await d.stop();
    await app.close();
  });

  it('C-F08-04 runFlow em escala 0,1 passa os passos 2 a 16', async () => {
    const lines: string[] = [];
    const r = await runFlow({ web, api: web, key: config.partnerApiKey, scale: SCALE, log: (l) => lines.push(l) });
    expect(r, lines.join('\n')).toMatchObject({ ok: true });
    expect(r.steps.map((s) => s.step)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(lines[0]).toBe('PASS pré-checagem');
    expect(lines.at(-1)).toMatch(/^FLOW OK — passos 2–16 \(escala 0\.1\) em [\d.]+ s$/);
  }, 180_000);
});
