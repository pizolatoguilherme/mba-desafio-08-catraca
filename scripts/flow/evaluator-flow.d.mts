// Tipos de scripts/flow/evaluator-flow.mjs (F08), para o import em test/f08/flow.integration.test.ts.

export interface FlowStep {
  step: number;
  ms: number;
  title: string;
}

export type FlowResult =
  | { ok: true; steps: FlowStep[] }
  | { ok: false; step: number; error: string; steps: FlowStep[] };

export function runFlow(opts: {
  web: string;
  api: string;
  key: string;
  scale?: number;
  log?: (line: string) => void;
}): Promise<FlowResult>;
