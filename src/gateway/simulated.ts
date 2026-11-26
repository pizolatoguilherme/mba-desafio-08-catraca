export type GatewayResult = 'approved' | 'declined';

export interface PaymentGateway {
  authorize(cardLast4: string): Promise<GatewayResult>;
}

interface Rule {
  result: GatewayResult;
  minMs: number;
  maxMs: number;
}

// Tabela do gateway simulado (docs/brief.md), em escala 1.
// 2–4 s fica dentro dos 2–5 s do brief e, somado à latência do dispatcher, garante < 5 s para o 0001.
const FAST = { minMs: 2000, maxMs: 4000 } as const;
const SLOW = { minMs: 30000, maxMs: 40000 } as const;

const RULES: Record<string, Rule> = {
  '0001': { result: 'approved', ...FAST },
  '0002': { result: 'declined', ...FAST },
  '0003': { result: 'approved', ...SLOW },
  '0004': { result: 'declined', ...SLOW },
};

const DEFAULT_RULE: Rule = { result: 'declined', ...FAST };

/** Resultado e atraso (em escala 1) para o final do cartão. Não aplica GATEWAY_DELAY_SCALE. */
export function decide(cardLast4: string, rnd: () => number = Math.random): { result: GatewayResult; delayMs: number } {
  const rule = Object.hasOwn(RULES, cardLast4) ? RULES[cardLast4] : DEFAULT_RULE;
  const delayMs = rule.minMs + Math.round(rnd() * (rule.maxMs - rule.minMs));
  return { result: rule.result, delayMs };
}

/** Gateway do modo padrão: responde conforme o final do cartão, com atraso multiplicado por `scale`. */
export class SimulatedGateway implements PaymentGateway {
  private readonly scale: number;
  private readonly rnd: () => number;

  constructor(opts: { scale: number; rnd?: () => number }) {
    if (typeof opts.scale !== 'number' || !Number.isFinite(opts.scale) || opts.scale < 0) {
      throw new RangeError('scale deve ser um número finito >= 0');
    }
    this.scale = opts.scale;
    this.rnd = opts.rnd ?? Math.random;
  }

  authorize(cardLast4: string): Promise<GatewayResult> {
    const { result, delayMs } = decide(cardLast4, this.rnd);
    const waitMs = Math.round(delayMs * this.scale);
    return new Promise((resolve) => {
      // unref: um timer de 30–40 s não segura o processo (testes, script) depois do fim.
      setTimeout(() => resolve(result), waitMs).unref();
    });
  }
}
