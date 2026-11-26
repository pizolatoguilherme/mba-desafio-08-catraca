import { describe, expect, it } from 'vitest';
import { decide, SimulatedGateway, type GatewayResult } from '../../src/gateway/simulated.js';

async function timed(gw: SimulatedGateway, last4: string): Promise<{ result: GatewayResult; ms: number }> {
  const t0 = performance.now();
  const result = await gw.authorize(last4);
  return { result, ms: performance.now() - t0 };
}

describe('F03 gateway simulado', () => {
  it('decide aplica a tabela de finais com rnd nos extremos', () => {
    const fast = [2000, 3000, 4000];
    const slow = [30000, 35000, 40000];
    const table: Array<[string, GatewayResult, number[]]> = [
      ['0001', 'approved', fast],
      ['0002', 'declined', fast],
      ['0003', 'approved', slow],
      ['0004', 'declined', slow],
      ['0000', 'declined', fast],
      ['0005', 'declined', fast],
      ['1234', 'declined', fast],
      ['9999', 'declined', fast],
      ['', 'declined', fast],
      ['abcd', 'declined', fast],
    ];
    const rnds = [() => 0, () => 0.5, () => 0.9999999];
    for (const [last4, result, delays] of table) {
      rnds.forEach((rnd, i) => {
        expect(decide(last4, rnd), `${last4} #${i}`).toEqual({ result, delayMs: delays[i] });
      });
    }
    // rnd default (Math.random): dentro da faixa
    for (let i = 0; i < 50; i++) {
      const d = decide('0001');
      expect(d.result).toBe('approved');
      expect(d.delayMs).toBeGreaterThanOrEqual(2000);
      expect(d.delayMs).toBeLessThanOrEqual(4000);
    }
  });

  it('SimulatedGateway em escala 1 responde 0001 e 0002 entre 2 e 4 s medidos', async () => {
    const gw = new SimulatedGateway({ scale: 1 });
    const [a, b] = await Promise.all([timed(gw, '0001'), timed(gw, '0002')]);
    expect(a.result).toBe('approved');
    expect(b.result).toBe('declined');
    for (const r of [a, b]) {
      expect(r.ms).toBeGreaterThanOrEqual(1995);
      expect(r.ms).toBeLessThanOrEqual(4100);
    }
  });

  it('GATEWAY_DELAY_SCALE 0,01 faz o 0003 responder entre 300 e 400 ms', async () => {
    const def = await timed(new SimulatedGateway({ scale: 0.01 }), '0003');
    expect(def.result).toBe('approved');
    expect(def.ms).toBeGreaterThanOrEqual(295);
    expect(def.ms).toBeLessThanOrEqual(450);

    const min = await timed(new SimulatedGateway({ scale: 0.01, rnd: () => 0 }), '0003');
    expect(min.result).toBe('approved');
    expect(min.ms).toBeGreaterThanOrEqual(295);
    expect(min.ms).toBeLessThanOrEqual(360);

    const max = await timed(new SimulatedGateway({ scale: 0.01, rnd: () => 0.9999999 }), '0003');
    expect(max.result).toBe('approved');
    expect(max.ms).toBeGreaterThanOrEqual(395);
    expect(max.ms).toBeLessThanOrEqual(460);
  });

  it('a escala multiplica os atrasos de todos os finais', async () => {
    const gw = new SimulatedGateway({ scale: 0.01, rnd: () => 0.5 });
    const cases: Array<[string, GatewayResult, number, number]> = [
      ['0001', 'approved', 28, 90],
      ['0002', 'declined', 28, 90],
      ['0009', 'declined', 28, 90],
      ['0003', 'approved', 345, 420],
      ['0004', 'declined', 345, 420],
    ];
    const results = await Promise.all(cases.map(([l4]) => timed(gw, l4)));
    cases.forEach(([l4, result, lo, hi], i) => {
      expect(results[i].result, l4).toBe(result);
      expect(results[i].ms, l4).toBeGreaterThanOrEqual(lo);
      expect(results[i].ms, l4).toBeLessThanOrEqual(hi);
    });
  });

  it('SimulatedGateway rejeita escala inválida', () => {
    for (const scale of [-1, NaN, Infinity, -Infinity]) {
      expect(() => new SimulatedGateway({ scale }), String(scale)).toThrow(RangeError);
    }
    expect(() => new SimulatedGateway({ scale: 0 })).not.toThrow();
  });
});
