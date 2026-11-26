import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPTS = ['up', 'down', 'gates', 'burst', 'check-parallel'].map((s) => join(ROOT, 'scripts', `${s}.sh`));

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// gh falso: imprime datas authoredDate fixas por número de PR.
const FAKE_DIR = mkdtempSync(join(tmpdir(), 'catraca-gh-'));
writeFileSync(
  join(FAKE_DIR, 'gh'),
  `#!/bin/sh
# uso esperado: gh pr view <n> --json commits --jq '.commits[].authoredDate'
case "$3" in
  1) printf '%s\\n' 2026-11-25T10:00:00Z 2026-11-25T12:00:00Z ;;
  2) printf '%s\\n' 2026-11-25T13:00:00Z 2026-11-25T11:00:00Z ;;
  3) printf '%s\\n' 2026-11-25T10:00:00Z 2026-11-25T11:00:00Z ;;
  4) printf '%s\\n' 2026-11-25T12:00:00Z 2026-11-25T13:00:00Z ;;
  *) echo "PR não encontrado" >&2; exit 1 ;;
esac
`,
);
chmodSync(join(FAKE_DIR, 'gh'), 0o755);
const FAKE_ENV = { ...process.env, PATH: `${FAKE_DIR}:${process.env.PATH ?? '/usr/bin:/bin'}` };
const EMPTY_DIR = mkdtempSync(join(tmpdir(), 'catraca-nogh-'));

afterAll(() => {
  rmSync(FAKE_DIR, { recursive: true, force: true });
  rmSync(EMPTY_DIR, { recursive: true, force: true });
});

const checkParallel = join(ROOT, 'scripts', 'check-parallel.sh');

describe('C-F01-21 scripts', () => {
  it('scripts do harness existem e são executáveis', () => {
    for (const s of SCRIPTS) {
      const st = statSync(s);
      expect(st.isFile(), s).toBe(true);
      expect(st.mode & 0o111, `${s} sem bit executável`).not.toBe(0);
      const syntax = run('sh', ['-n', s]);
      expect(syntax.status, `${s}: ${syntax.out}`).toBe(0);
    }
    // architecture.md §8 #16: os scripts .mjs passam em node --check
    const mjs = readdirSync(join(ROOT, 'scripts'), { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.mjs'));
    expect(mjs).toContain('check-artifacts.mjs');
    for (const f of mjs) {
      const check = run(process.execPath, ['--check', join(ROOT, 'scripts', f)]);
      expect(check.status, `${f}: ${check.out}`).toBe(0);
    }
  });

  it('burst.sh --help mostra o uso', () => {
    for (const flag of ['--help', '-h']) {
      const r = run('sh', [join(ROOT, 'scripts', 'burst.sh'), flag]);
      expect(r.status).toBe(0);
      expect(r.out.startsWith('Uso: scripts/burst.sh [rodadas]')).toBe(true);
    }
    for (const bad of ['abc', '0', '-1', '1.5']) {
      const r = run('sh', [join(ROOT, 'scripts', 'burst.sh'), bad]);
      expect(r.status, `rodadas=${bad}`).toBe(2);
      expect(r.out).toContain('Uso: scripts/burst.sh [rodadas]');
    }
  });

  it('check-parallel aprova PRs com commits sobrepostos', () => {
    const r = run('sh', [checkParallel, '1', '2'], FAKE_ENV);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('OK #1 primeiro=2026-11-25T10:00:00Z < #2 último=2026-11-25T13:00:00Z');
    expect(r.out).toContain('OK #2 primeiro=2026-11-25T11:00:00Z < #1 último=2026-11-25T12:00:00Z');
    expect(r.out).not.toContain('FALHA');
  });

  it('check-parallel reprova PRs sequenciais', () => {
    const r = run('sh', [checkParallel, '3', '4'], FAKE_ENV);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('OK #3 primeiro=2026-11-25T10:00:00Z < #4 último=2026-11-25T13:00:00Z');
    expect(r.out).toContain('FALHA #4 primeiro=2026-11-25T12:00:00Z');
    // um terceiro PR sobreposto não "salva" o par sequencial
    expect(run('sh', [checkParallel, '1', '3', '4'], FAKE_ENV).status).toBe(1);
  });

  it('check-parallel exige pelo menos 2 PRs', () => {
    for (const args of [[], ['1']]) {
      const r = run('sh', [checkParallel, ...args], FAKE_ENV);
      expect(r.status).toBe(2);
      expect(r.out).toContain('Uso: scripts/check-parallel.sh <pr> <pr> [...]');
    }
    // sem gh no PATH: uso e saída 2
    const noGh = run('/bin/sh', [checkParallel, '1', '2'], { ...process.env, PATH: EMPTY_DIR });
    expect(noGh.status).toBe(2);
    expect(noGh.out).toContain('Uso: scripts/check-parallel.sh <pr> <pr> [...]');
  });
});
