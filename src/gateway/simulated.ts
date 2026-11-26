export type GatewayResult = 'approved' | 'declined';

export interface PaymentGateway {
  authorize(cardLast4: string): Promise<GatewayResult>;
}

export function decide(cardLast4: string, rnd?: () => number): { result: GatewayResult; delayMs: number } {
  void cardLast4;
  void rnd;
  throw new Error('F03: não implementado');
}

export class SimulatedGateway implements PaymentGateway {
  constructor(opts: { scale: number; rnd?: () => number }) {
    void opts;
  }

  async authorize(cardLast4: string): Promise<GatewayResult> {
    void cardLast4;
    throw new Error('F03: não implementado');
  }
}
