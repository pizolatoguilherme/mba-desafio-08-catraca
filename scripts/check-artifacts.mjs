#!/usr/bin/env node
// Verifica os artefatos de entrega da Catraca contra os requisitos do enunciado.
// Uso: node scripts/check-artifacts.mjs [--prd] [--specs] [--reports] [--state] [--readme] [--all]
// Sem flags = --all.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const all = args.size === 0 || args.has('--all');
const want = (f) => all || args.has(f);

let failures = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const fail = (msg) => { failures++; console.log(`  ✘ ${msg}`); };
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const FEATURE_DIRS = {
  F01: 'F01-fundacao', F02: 'F02-contas', F03: 'F03-gateway', F04: 'F04-eventos',
  F05: 'F05-compras', F06: 'F06-api-parceiros', F07: 'F07-checkin-painel', F08: 'F08-cancelamento',
};

// ---------- PRD ----------
const prd = read('docs/PRD.md');
const features = [...prd.matchAll(/^\|\s*(F\d{2})\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/gm)]
  .map((m) => ({ id: m[1], name: m[2].trim(), provides: m[3].trim(), consumes: m[4].trim() }))
  .filter((f, i, arr) => arr.findIndex((x) => x.id === f.id) === i);
const mermaid = prd.match(/```mermaid([\s\S]*?)```/)?.[1] ?? '';
const edges = [...mermaid.matchAll(/(F\d{2})\s*-->\s*(F\d{2})/g)].map((m) => ({ provider: m[1], consumer: m[2] }));
const acIds = [...new Set([...prd.matchAll(/\*\*(AC-F\d{2}-\d{2})\*\*/g)].map((m) => m[1]))];
const xcIds = [...new Set([...prd.matchAll(/\*\*(XC-F\d{2}-F\d{2}-\d{2})\*\*/g)].map((m) => m[1]))];

if (want('--prd')) {
  console.log('PRD (docs/PRD.md)');
  check(features.length >= 5, `≥5 features com ID (${features.length}: ${features.map((f) => f.id).join(', ')})`);
  for (const f of features) {
    check(f.provides.length > 3, `${f.id} declara o que provê`);
    // consome pode ser "—" para a raiz; verificamos coerência com o grafo
    const declared = (f.consumes.match(/F\d{2}/g) || []).sort().join(',');
    const fromGraph = edges.filter((e) => e.consumer === f.id).map((e) => e.provider).sort().join(',');
    check(declared === fromGraph, `${f.id} consome [${declared || '—'}] = grafo [${fromGraph || '—'}]`);
  }
  check(edges.length > 0, `grafo de dependências com ${edges.length} arestas`);
  const waveRows = [...prd.matchAll(/^\|\s*W\d\s*\|\s*([^|]+)\|/gm)].map((m) => m[1].match(/F\d{2}/g) || []);
  check(waveRows.length > 0 && waveRows.some((w) => w.length >= 2), `waves definidas (${waveRows.length}), alguma com ≥2 features`);
  for (const f of features) check(acIds.some((a) => a.startsWith(`AC-${f.id}-`)), `${f.id} tem critérios de aceite`);
  for (const e of edges) {
    const xc = xcIds.filter((x) => x.startsWith(`XC-${e.consumer}-${e.provider}-`));
    check(xc.length >= 1, `aresta ${e.provider}→${e.consumer} tem critério cross-feature (${xc.join(', ') || 'nenhum'})`);
  }
  const criteriaLines = prd.split('\n').filter((l) => /^- \*\*(AC|XC)-/.test(l));
  for (let i = 1; i <= 13; i++) {
    const r = `R${String(i).padStart(2, '0')}`;
    check(criteriaLines.some((l) => new RegExp(`\\b${r}\\b`).test(l)), `${r} citada em ≥1 critério`);
  }
  check(/^##\s.*Fora de escopo/im.test(prd), 'seção "Fora de escopo" presente');
}

// ---------- Specs / plans / contracts ----------
if (want('--specs')) {
  console.log('Specs, planos e contratos (docs/features/*)');
  const contracts = {};
  for (const [id, dir] of Object.entries(FEATURE_DIRS)) {
    for (const file of ['spec.md', 'plan.md', 'contract.md']) {
      check(existsSync(join(ROOT, 'docs/features', dir, file)), `${id}: ${file} existe`);
    }
    const cp = join(ROOT, 'docs/features', dir, 'contract.md');
    if (!existsSync(cp)) continue;
    const c = readFileSync(cp, 'utf8');
    contracts[id] = c;
    check(/pr[ée]-requisitos/i.test(c), `${id}: contrato tem pré-requisitos de ambiente`);
    const items = [...new Set([...c.matchAll(/\b(C-F\d{2}-\d{2})\b/g)].map((m) => m[1]))];
    check(items.length > 0, `${id}: contrato tem itens verificáveis (${items.length})`);
    const mapSection = c.split(/^##\s.*Mapeamento.*$/im)[1] ?? '';
    check(mapSection.length > 0, `${id}: contrato tem seção de mapeamento`);
    for (const ac of acIds.filter((a) => a.startsWith(`AC-${id}-`))) {
      const line = mapSection.split('\n').find((l) => l.includes(ac));
      check(Boolean(line && /C-F\d{2}-\d{2}/.test(line.replace(ac, ''))), `${id}: ${ac} mapeado a ≥1 item`);
    }
  }
  for (const xc of xcIds) {
    const covered = Object.entries(contracts).filter(([, c]) => {
      const mapSection = c.split(/^##\s.*Mapeamento.*$/im)[1] ?? '';
      const line = mapSection.split('\n').find((l) => l.includes(xc));
      return line && /C-F\d{2}-\d{2}/.test(line.replace(xc, ''));
    }).map(([id]) => id);
    check(covered.length >= 1, `${xc} coberto em contrato (${covered.join(', ') || 'nenhum'})`);
  }
}

// ---------- Reports + state ----------
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
if (want('--reports') || want('--state')) {
  console.log('Relatórios e estado');
  const state = JSON.parse(read('state/project-state.json'));
  for (const [id, dir] of Object.entries(FEATURE_DIRS)) {
    const rdir = join(ROOT, 'docs/features', dir, 'reports');
    const reports = existsSync(rdir) ? readdirSync(rdir).filter((f) => f.endsWith('.md')).sort() : [];
    check(reports.length >= 1, `${id}: ≥1 relatório (${reports.length})`);
    for (const r of reports) {
      const rel = `docs/features/${dir}/reports/${r}`;
      const body = read(rel);
      check(/\*\*Data:\*\*/.test(body) && /\*\*Commit avaliado:\*\*\s*`?[0-9a-f]{7,40}/.test(body)
        && /\*\*Ferramenta:\*\*/.test(body) && /\*\*Modelo:\*\*/.test(body), `${rel}: cabeçalho completo`);
      let commits = [];
      try { commits = git('log', '--all', '--format=%h', '--', rel).split('\n').filter(Boolean); } catch { /* */ }
      check(commits.length === 1, `${rel}: aparece em exatamente 1 commit (${commits.length})`);
    }
    const latest = reports.at(-1);
    if (latest) {
      const body = read(`docs/features/${dir}/reports/${latest}`);
      check(/Veredito geral:\*\*\s*APROVADO/.test(body) && !/\|\s*(FAIL|BLOCKED)\s*\|/.test(body), `${id}: relatório mais recente APROVADO (${latest})`);
    }
    const s = state.features?.[id];
    check(s?.status === 'done', `${id}: estado = done (${s?.status})`);
    check(Boolean(s?.latestReport) && existsSync(join(ROOT, s.latestReport)), `${id}: latestReport existe (${s?.latestReport})`);
    if (latest && s?.latestReport) check(s.latestReport.endsWith(latest), `${id}: latestReport é o mais recente`);
  }
  let coauthor = '';
  try { coauthor = git('log', '--all', '--format=%B').split('\n').filter((l) => /co-authored-by:\s*claude/i.test(l)).join('\n'); } catch { /* */ }
  check(coauthor === '', 'nenhum commit com Co-Authored-By: Claude');
}

// ---------- README ----------
if (want('--readme')) {
  console.log('README e AGENTS.md');
  const readme = read('README.md');
  for (const s of ['Como rodar', 'Endereços', 'Credenciais', 'Mapa dos artefatos', 'Decisões']) {
    check(new RegExp(`^##\\s.*${s}`, 'im').test(readme), `README tem seção "${s}"`);
  }
  check(/github\.com\/[^\s)]+\/pull\/\d+/.test(readme), 'README lista links de PRs');
  const agents = read('AGENTS.md');
  check(/npm run up/.test(agents) && /npm run down/.test(agents) && /npm run gates/.test(agents), 'AGENTS.md tem up/down/gates');
  check(/Mapa dos artefatos/i.test(agents), 'AGENTS.md tem mapa dos artefatos');
  check(/AGENTS\.md/.test(read('CLAUDE.md')), 'CLAUDE.md aponta para AGENTS.md');
}

console.log(failures === 0 ? '\nOK: todas as verificações passaram.' : `\nFALHOU: ${failures} verificação(ões).`);
process.exit(failures === 0 ? 0 : 1);
