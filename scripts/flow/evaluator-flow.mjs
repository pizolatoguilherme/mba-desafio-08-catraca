#!/usr/bin/env node
// F08: Fluxo do avaliador (docs/brief.md, passos 2–16) contra o produto no ar.
// Node 22 puro, sem dependências. Esqueleto (etapa 1): só a pré-checagem.
import { pathToFileURL } from 'node:url';

export async function runFlow(opts) {
  const log = opts.log ?? ((line) => console.log(line));
  const steps = [];
  try {
    const res = await fetch(`${opts.web}/healthz`);
    if (res.status !== 200) throw new Error(`GET /healthz → esperado 200 / obtido ${res.status}`);
    log('PASS pré-checagem');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`FAIL pré-checagem — ${msg}`);
    return { ok: false, step: 1, error: msg, steps };
  }
  return { ok: true, steps };
}

async function main() {
  const web = process.env.WEB || `http://localhost:${process.env.CATRACA_PORT || 3000}`;
  const api = process.env.API || web;
  const key = process.env.KEY || process.env.PARTNER_API_KEY || 'catraca-parceiro-2026';
  const scale = Number(process.env.FLOW_SCALE || 1);
  const r = await runFlow({ web, api, key, scale });
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
