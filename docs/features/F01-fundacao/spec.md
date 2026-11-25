# Spec — F01 Fundação & Harness

> Wave W0 (sequencial) · Branch `feat/F01-fundacao` · Consome: — · Consumida por: F02, F03, F04 (e, transitivamente, por F05–F08)
> Fontes: [`docs/brief.md`](../../brief.md) (Harness mínimo, critérios "Ambiente e harness"), [`docs/PRD.md`](../../PRD.md) (AC-F01-01…10), [`docs/architecture.md`](../../architecture.md) (§1–§5). Os nomes e assinaturas abaixo são os do `architecture.md`. Onde esta spec acrescenta algo, isso está marcado como **(complemento)**.

## 1. Objetivo

Entregar o esqueleto executável da Catraca e o harness do projeto:

- servidor Fastify + EJS com layout, `/healthz` e páginas de erro;
- infraestrutura de banco (`pool`, `query`, `withTransaction`), migração com o **schema completo** e seed idempotente;
- utilitários compartilhados (`ids`, `format`, `hashPassword`) e helpers de teste;
- Docker (multi-stage), Compose do produto e Compose dos gates;
- os comandos `npm run up | down | gates`, que funcionam num clone limpo **sem `npm install`**;
- os scripts `burst.sh` (passo 15 do brief) e `check-parallel.sh` (prova do paralelismo);
- o CI (GitHub Actions) rodando `npm run gates`;
- o README com a estrutura de seções do Entregável.

Ao final de F01, `npm run up` sobe um produto "vazio" (placeholder na `/`, seed carregada) e `npm run gates` roda lint, typecheck e testes contra um Postgres efêmero.

## 2. Escopo

**Dentro:**
- `package.json` com os scripts `up`, `down`, `gates`, `gates:inner`, `lint`, `typecheck`, `test`, `build`, `flow`, `verify:delivery`, e `package-lock.json` commitado (o `npm ci` do Dockerfile depende dele).
- Todas as dependências de runtime que as features W1–W5 vão usar já entram aqui: `fastify@5`, `@fastify/view@10`, `ejs@3`, `@fastify/formbody@8`, `@fastify/cookie@11`, `fastify-plugin@5`, `pg@8`. Assim, F02 e F03 (wave paralela) não precisam mexer no `package.json`.
- Dev: `typescript@5`, `@types/node@22`, `@types/pg`, `@types/ejs`, `vitest`, `eslint@9`, `@eslint/js`, `typescript-eslint@8`, `globals`.
- `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `vitest.config.ts`, `.dockerignore`.
- `Dockerfile` com os stages `deps`, `build`, `runtime` e `dev`.
- `compose.yaml` (serviços `db` e `app`) e `compose.gates.yaml` (`testdb` em tmpfs + `gates`).
- `scripts/up.sh`, `scripts/down.sh`, `scripts/gates.sh`, `scripts/burst.sh`, `scripts/check-parallel.sh`.
- `migrations/001_init.sql` (schema completo do `architecture.md` §3), `src/migrate.ts`, `src/seed.ts`.
- `src/config.ts`, `src/db.ts`, `src/ids.ts`, `src/format.ts`, `src/features.ts`, `src/server.ts`, `src/auth/password.ts` (só `hashPassword`).
- `src/views/layout.ejs`, `src/views/home.ejs` (placeholder), `src/views/error.ejs`.
- `test/helpers.ts`, `test/global-setup.ts`, `test/setup.ts` e os testes `test/f01/*.test.ts`.
- `.github/workflows/gates.yml`.
- `README.md` com a estrutura completa de seções, e com credenciais, endereços, chave e comandos já preenchidos.

**Fora (de F01):**
- Autenticação, sessão, guards, `verifyPassword`, `/login`, `/signup`, `loginAs` → F02.
- Gateway, dispatcher, a ação real de `startDispatcher` → F03. F01 só aceita a opção.
- Vitrine, eventos, compras, API, check-in, painel, cancelamento → F04–F08.
- `scripts/flow/evaluator-flow.mjs` → F08. F01 só declara o script `flow` no `package.json`.
- `burst.sh` **funcionando de ponta a ponta**: ele depende da API de F06. Em F01, o contrato verifica só que o script existe, é executável e mostra o uso.
- Alterar `AGENTS.md`, `CLAUDE.md`, `docs/**`, `prompts/**` ou `scripts/check-artifacts.mjs`. Esses arquivos já existem; o contrato só verifica `AGENTS.md`/`CLAUDE.md`.
- Completar o README (links dos PRs das waves paralelas, decisões finais) e o estado final (`done` + relatórios) → validação final (Fase 9).

## 3. Decisões técnicas (e por quê)

| # | Decisão | Por quê |
|---|---|---|
| D1 | Scripts `up`/`down`/`gates` do `package.json` são `sh scripts/<x>.sh`, e os scripts são POSIX `sh` (`#!/bin/sh`, `set -eu`). | O `npm run` executa scripts sem `node_modules`, então funciona num clone limpo. O POSIX `sh` roda em Linux, no macOS e no `node:22-alpine` (sem bash), onde os testes de script rodam. |
| D2 | `docker compose up -d --build --wait --wait-timeout 300` em `up.sh`. O healthcheck do `app` chama `/healthz`. | O comando só retorna quando o app está `healthy` (AC-F01-01). O entrypoint roda `migrate && seed && server`, então o `/healthz` só responde depois da seed. |
| D3 | Entrypoint do `runtime`: `sh -c "node dist/migrate.js && node dist/seed.js && exec node dist/server.js"`, com `init: true` no Compose. | Com o `exec`, o node vira o processo principal e recebe o `SIGTERM` do `down`, e o `init` repassa sinais. Isso dá encerramento limpo. |
| D4 | `compose.yaml` com `name: catraca` no topo; sem `container_name`; volume nomeado `db-data`; só o `app` publica porta (`"${CATRACA_PORT:-3000}:3000"`); `db` sem `ports`. | `COMPOSE_PROJECT_NAME` sobrescreve o `name`, o que dá containers, rede, volume e imagem por projeto. Assim, duas worktrees convivem (AC-F01-08) e o Postgres não fica exposto (AC-F01-02). |
| D5 | Gates em projeto Compose separado, `${COMPOSE_PROJECT_NAME:-catraca}-gates`, com o banco no serviço `testdb` (nome diferente do `db` do produto) em `tmpfs` e sem portas publicadas. `gates.sh` instala `trap … down -v --remove-orphans` em `EXIT`. | Os gates não tocam nos containers do produto (AC-F01-04), não deixam nada rodando e cada execução começa com um banco vazio. |
| D6 | **(complemento)** `scripts/gates.sh [args…]`: sem argumentos, roda `npm run gates:inner` via `up --abort-on-container-exit --exit-code-from gates`, como no `architecture.md`. Com argumentos, roda `npx vitest run <args>` no mesmo container (`compose build gates` + `compose run --rm -T gates npx vitest run "$@"`). Nos dois modos, o `trap` derruba o projeto `-gates` com `down -v`. | Os contratos pedem testes vitest **nomeados** executados via gates. Por exemplo, `npm run gates -- test/f01/format.test.ts --reporter=verbose` roda só esse arquivo, sem `npm install` no host e sem expor o banco. |
| D7 | `TZ=America/Sao_Paulo` em `db`, `app` e `gates`. A imagem instala `tzdata`. `format.ts` usa `Intl` com `timeZone: 'America/Sao_Paulo'` explícito. | O fuso fica fixo no ambiente, e as funções de data continuam corretas mesmo se o `TZ` do processo for outro, por exemplo num teste local. |
| D8 | Views resolvidas por `fileURLToPath(new URL('../src/views/', import.meta.url))` e migrações por `new URL('../migrations/', import.meta.url)`. O stage `runtime` copia `dist/`, `src/views/` e `migrations/`. | O mesmo caminho relativo funciona a partir de `src/*.ts` (testes, via vitest) e de `dist/*.js` (produção), sem copiar views para `dist`. |
| D9 | `migrate.ts` aplica `migrations/*.sql` em ordem lexicográfica. Cada arquivo roda em uma transação, e `schema_migrations.version` = nome do arquivo sem `.sql` (ex.: `001_init`). Usa `pg_advisory_lock` durante a execução. | A migração é idempotente e segura contra dupla execução (gates + app). Uma migração futura com prefixo de timestamp (`20261125T1530_x`) ordena depois de `001_init`. |
| D10 | Seed = upsert por `lower(email)` (`INSERT … ON CONFLICT ((lower(email))) DO UPDATE SET name, role, password_hash`). A seed **não** cria eventos. | Reexecutável: sempre ficam exatamente 2 organizadores e 1 participante da seed (AC-F01-03), e as credenciais do README sempre funcionam. Sem eventos, o Fluxo do avaliador começa limpo (passo 2). |
| D11 | Hash de senha: `scrypt` do `node:crypto`, salt de 16 bytes aleatórios (passado ao scrypt como os **bytes brutos**; no texto vai em hex), `keylen` 64, N=16384, r=8, p=1, formato `scrypt$<salt hex 32>$<hash hex 128>`. | Formato fixado no schema (§3 do `architecture.md`). Não exige dependência nativa, e F02 verifica com os mesmos parâmetros. |
| D12 | `buildApp` registra o core (formbody, cookie, view com layout, `/healthz`, handler 404, handler de erro 500) e, em seguida, `featurePlugins` em ordem (`await app.register(p)`). Só **depois**, se `!app.hasRoute({ method: 'GET', url: '/' })`, registra o placeholder `GET /` (`home.ejs`). | F04 substitui a home registrando `GET /` no próprio plugin, **sem editar `server.ts`**. Isso evita conflito de rota e de arquivo. |
| D13 | Vitest com `fileParallelism: false`, `globalSetup: test/global-setup.ts` (roda `runMigrations()` uma vez), `setupFiles: test/setup.ts` (`afterAll(() => pool.end())`), `testTimeout`/`hookTimeout` 60 s, `include: ['test/**/*.test.ts']`, `env: { LOG_LEVEL: 'silent' }`. | Os arquivos de teste compartilham um único banco e o `resetDb` faz `TRUNCATE`; rodar em série evita interferência. Fechar o pool evita handles pendurados. |
| D14 | ESLint (flat config, `@eslint/js` recommended + `typescript-eslint` recommended) sobre `src/`, `test/` e os arquivos de config. Ignora `dist/`, `node_modules/`, `coverage/` e `scripts/`. | `scripts/check-artifacts.mjs` (pré-existente e fora do escopo de F01) usa array esparso (`[, '']`), o que `no-sparse-arrays` reprova. Os scripts `.sh`/`.mjs` são checados nos testes de `test/f01/scripts.test.ts` (`sh -n`, `node --check`). |
| D15 | `tsconfig.json` (`noEmit`, `strict`, `module`/`moduleResolution` `NodeNext`, `target` ES2022, inclui `src`, `test` e `vitest.config.ts`) para o typecheck. `tsconfig.build.json` (estende o anterior, `rootDir: src`, `outDir: dist`, inclui só `src`) para o build. | O typecheck cobre os testes, e o build gera `dist/` limpo. |
| D16 | `check-parallel.sh` compara o **`authoredDate`** dos commits (`gh pr view <n> --json commits --jq '.commits[].authoredDate'`). | O `authoredDate` não muda em rebase, ao contrário do `committedDate`. É a data que prova que o trabalho começou antes do fim dos outros PRs. |
| D17 | `down.sh` derruba o projeto do produto e também o projeto `-gates` (se tiver sobrado de um gates interrompido). Nenhum dos dois usa `-v` no produto. | AC-F01-02 exige que nenhum container do projeto continue rodando. O volume do produto é mantido, como o AGENTS.md documenta. |

## 4. Interfaces PROVIDAS

### 4.1 TypeScript (assinaturas fixas do `architecture.md` §5)

```ts
// src/config.ts
export interface Config { port: number; databaseUrl: string; gatewayDelayScale: number; gatewayPollMs: number; partnerApiKey: string; }
export const config: Config;                       // = loadConfig(process.env), lido no import
export function loadConfig(env: NodeJS.ProcessEnv): Config;   // (complemento) para testar os defaults
// env → campo (default): PORT → port (3000); DATABASE_URL → databaseUrl ('postgres://catraca:catraca@localhost:5432/catraca');
// GATEWAY_DELAY_SCALE → gatewayDelayScale (1); GATEWAY_POLL_MS → gatewayPollMs (250); PARTNER_API_KEY → partnerApiKey ('catraca-parceiro-2026')
// Valor numérico inválido ou vazio → default.

// src/db.ts
export const pool: pg.Pool;                                   // max 50 conexões; connectionString = config.databaseUrl
export function query<T>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
export function withTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T>;  // BEGIN/COMMIT/ROLLBACK; sempre libera o client
export type Db = pg.Pool | pg.PoolClient;

// src/ids.ts
export function newId(prefix: 'usr'|'evt'|'tkt'): string;       // prefix + '_' + 10 chars [a-z0-9] (crypto.randomInt)
export function newTicketCode(): string;                          // 8 chars do alfabeto ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (sem 0, 1, O, I)

// src/format.ts
export type TicketStatus = 'pending'|'confirmed'|'declined'|'cancelled'|'refunded';
export function formatBRL(cents: number): string;     // 35000 -> "R$ 350,00"; 0 -> "R$ 0,00"; 123456 -> "R$ 1.234,56" (espaço comum U+0020, nunca NBSP)
export function toIsoWithOffset(d: Date): string;     // em America/Sao_Paulo: 2026-12-06T00:00:00Z -> "2026-12-05T21:00:00-03:00"
export function parseLocalDateTime(s: string): Date | null; // "YYYY-MM-DDTHH:mm" ou "YYYY-MM-DDTHH:mm:ss" em America/Sao_Paulo; data inexistente/formato errado -> null
export function parsePriceToCents(s: string): number | null;
  // trim; prefixo opcional "R$"; aceita /^\d+([.,]\d{1,2})?$/: "100,00" | "100.00" | "100" -> 10000; "150,5" -> 15050; "0" -> 0
  // inválido ("", "abc", "-1", "1.234,56", "10,999") -> null. A regra "> 0" é de F04 (validateEventInput), não do parser.
export function statusLabel(s: TicketStatus): string; // pending->"pendente", confirmed->"confirmado", declined->"recusado", cancelled->"cancelado", refunded->"estornado"

// src/auth/password.ts   (F01 cria; F02 acrescenta verifyPassword no mesmo arquivo)
export function hashPassword(p: string): Promise<string>;   // "scrypt$<salt hex 32>$<hash hex 128>"

// src/features.ts
import type { FastifyPluginAsync } from 'fastify';
export const featurePlugins: FastifyPluginAsync[] = [
  // cada feature acrescenta UMA linha aqui (F02: authPlugin, …)
];

// src/server.ts
export async function buildApp(opts?: { startDispatcher?: boolean }): Promise<FastifyInstance>;
  // F01 aceita startDispatcher e o ignora (F03 implementa). Não chama listen nem ready.
// Execução direta (node dist/server.js): buildApp({ startDispatcher: true }) + listen({ host: '0.0.0.0', port: config.port });
// SIGTERM/SIGINT -> app.close() -> pool.end() -> exit 0.

// src/migrate.ts  (complemento: export nomeado; execução direta = runMigrations() + pool.end())
export async function runMigrations(): Promise<string[]>;   // devolve as versões aplicadas nesta execução ([] se nada pendente)

// src/seed.ts     (complemento: export nomeado; execução direta = runSeed() + pool.end())
export const SEED_USERS: ReadonlyArray<{ role: 'organizer'|'participant'; name: string; email: string; password: string }>;
export async function runSeed(db?: Db): Promise<void>;     // upsert dos 3 usuários de §4 do architecture.md

// test/helpers.ts
export async function resetDb(): Promise<void>;   // TRUNCATE users, sessions, events, tickets, payments RESTART IDENTITY CASCADE; depois runSeed()
export async function createUser(p: { role: 'participant'|'organizer'; email?: string; password?: string; name?: string }): Promise<{ id: string; email: string; password: string }>;
  // defaults: email "u-<10 chars>@example.com", password "senha123", name "Usuário Teste"; grava hashPassword(password)
export async function createEvent(p: { organizerId: string; status?: 'draft'|'published'|'cancelled'; capacity?: number; priceCents?: number; startsAt?: Date; name?: string; venue?: string }): Promise<{ id: string }>;
  // defaults: status 'published' (published_at = now()), capacity 10, priceCents 10000, startsAt now + 7 dias,
  // name "Evento Teste", venue "Local Teste"; 'cancelled' preenche published_at e cancelled_at
export async function insertTicket(p: { eventId: string; status?: TicketStatus; priceCents?: number; channel?: 'web'|'partner'; userId?: string|null; buyerEmail?: string; code?: string; checkedIn?: boolean }): Promise<{ id: string; code: string }>;
  // defaults: status 'pending', priceCents = events.price_cents do evento, channel 'web' se userId, senão 'partner', userId null,
  // buyerEmail "comprador@example.com", code newTicketCode(), card_last4 '0001', checkedIn false (true -> checked_in_at = now()).
  // Só grava em tickets (não cria linha em payments).
```

### 4.2 HTTP

| Rota | Resposta |
|---|---|
| `GET /healthz` | Executa `SELECT 1`. Sucesso: `200`, `Content-Type: application/json`, corpo `{"ok":true}`. Falha no banco: `503` `{"ok":false}`. |
| `GET /` | Placeholder (só se nenhuma feature registrou `GET /`, ver D12): `200`, HTML de `home.ejs` dentro do layout. |
| qualquer rota inexistente | `404`, `error.ejs` com `status: 404`. |
| erro não tratado (fora de escopos com handler próprio, como o de F06) | `500`, `error.ejs` com `status: 500`, sem stack trace no corpo. |

Plugins registrados pelo core: `@fastify/formbody`, `@fastify/cookie` (sem secret), `@fastify/view` (`engine: { ejs }`, `root` = `src/views`, `layout: 'layout.ejs'`).

### 4.3 Views (contrato de locals e seletores estáveis)

- `layout.ejs`: `<!doctype html><html lang="pt-BR">`, `<meta charset="utf-8">`, `<title>Catraca</title>`, `<header>` com `<a href="/" data-brand>Catraca</a>` e `<nav data-nav></nav>` (vazio em F01; F02 preenche), `<main><%- body %></main>`. O layout de F01 não usa nenhuma variável além de `body`.
- `home.ejs`: `<section data-page="home"><h1>Catraca</h1><p>Vitrine em construção.</p></section>`.
- `error.ejs`, locals `{ status: number; title: string; message?: string }`: `<section data-page="error"><h1 data-error-status="<%= status %>"><%= title %></h1>` e, se houver, `<p><%= message %></p>`.

  Títulos padrão:

  | status | title |
  |---|---|
  | 404 | `Página não encontrada` (message: `O endereço acessado não existe ou não está disponível.`) |
  | 403 | `Acesso negado` |
  | 500 | `Erro interno` |

  As features que respondem 404/403 "genérico" (R13) usam `reply.code(404).view('error.ejs', { status: 404, title: 'Página não encontrada', message: … })`. Assim, o corpo é idêntico ao de uma rota inexistente e não vaza dados.

### 4.4 Harness (comandos e arquivos)

| Item | Comportamento |
|---|---|
| `npm run up` → `sh scripts/up.sh` | Verifica `docker compose version`. Se faltar, imprime `Docker Compose v2 é necessário` e sai com 1. Depois roda `docker compose up -d --build --wait --wait-timeout 300`. Em sucesso, imprime `Catraca no ar: http://localhost:${CATRACA_PORT:-3000}`. Em falha, imprime `docker compose logs --tail 100 app` e sai com ≠ 0. |
| `npm run down` → `sh scripts/down.sh` | `docker compose down --remove-orphans` e `docker compose -p "${COMPOSE_PROJECT_NAME:-catraca}-gates" -f compose.gates.yaml down -v --remove-orphans`. Mantém o volume do produto. |
| `npm run gates` → `sh scripts/gates.sh [args…]` | Ver D5/D6. O código de saída é o do container `gates`. |
| `npm run gates:inner` | `npm run lint && npm run typecheck && npm run test` (dentro do container `dev`). |
| `npm run lint` / `typecheck` / `test` / `build` | `eslint .` / `tsc --noEmit` / `vitest run` / `tsc -p tsconfig.build.json`. |
| `npm run flow` | `node scripts/flow/evaluator-flow.mjs` (arquivo de F08; falha até F08 existir). |
| `npm run verify:delivery` | `node scripts/check-artifacts.mjs --all`. |
| `scripts/burst.sh [rodadas]` | Default de 2 rodadas. Usa `API=${API:-http://localhost:${CATRACA_PORT:-3000}}` e `KEY=${KEY:-${PARTNER_API_KEY:-catraca-parceiro-2026}}`. Em cada rodada: (1) cria um evento novo **publicado**, de lotação 5 e preço 1000, do org A, via `docker compose exec -T db psql -U catraca -d catraca -Atc "INSERT INTO events (…) SELECT 'evt_' || substr(md5(random()::text), 1, 10), id, 'Rajada <n>', 'Local Rajada', now() + interval '7 days', 5, 1000, 'published', now() FROM users WHERE email = 'org.a@catraca.dev' RETURNING id"`; (2) dispara o comando literal do passo 15 do brief (`seq 30 \| xargs -P 30 -I{} curl … \| sort \| uniq -c`) contra esse evento; (3) imprime `Rodada <n> (<evt_id>): <contagem 202> x 202, <contagem 409> x 409 — OK\|FALHOU`. Sai com 0 só se **todas** as rodadas derem exatamente 5×202 e 25×409. `--help`/`-h` imprime `Uso: scripts/burst.sh [rodadas]` e sai com 0. Rodadas não numéricas ou < 1 → uso + saída 2. Só funciona de ponta a ponta depois de F06. |
| `scripts/check-parallel.sh <pr> <pr> [...]` | Para cada PR, lê as datas `authoredDate` dos commits via `gh pr view <n> --json commits --jq '.commits[].authoredDate'`; `first` = menor, `last` = maior (strings ISO UTC, comparadas lexicograficamente). Para cada par (i, j), i ≠ j, exige `first_i < last_j` e imprime `OK #i primeiro=<t> < #j último=<t>` ou `FALHA …`. Sai com 0 se todos os pares passam, 1 se algum falha e 2 se receber menos de 2 PRs ou se o `gh` não estiver no `PATH` (`Uso: scripts/check-parallel.sh <pr> <pr> [...]`). |
| `Dockerfile` | `deps`: `node:22-alpine`, `apk add --no-cache tzdata`, `COPY package*.json`, `npm ci`. `build`: a partir de `deps`, copia `tsconfig*.json` e `src/`, roda `npm run build`. `runtime`: `node:22-alpine` + `tzdata`, `npm ci --omit=dev`, copia `dist/`, `src/views/` e `migrations/`, `ENV NODE_ENV=production`, `EXPOSE 3000`, `CMD` do D3. `dev`: a partir de `deps`, `COPY . .`, `CMD ["npm","run","gates:inner"]`. As linhas `FROM` seguem o formato `FROM <imagem> AS <stage>`. |
| `compose.yaml` | `name: catraca`. `db`: `postgres:16-alpine`, `POSTGRES_USER/PASSWORD/DB=catraca`, `TZ`/`PGTZ=America/Sao_Paulo`, volume `db-data:/var/lib/postgresql/data`, healthcheck `pg_isready -U catraca -d catraca` (intervalo 2 s, 30 tentativas), sem `ports`. `app`: `build: { context: ., target: runtime }`, `init: true`, `depends_on: { db: { condition: service_healthy } }`, `ports: ["${CATRACA_PORT:-3000}:3000"]`. Environment: `TZ=America/Sao_Paulo`, `PORT=3000`, `DATABASE_URL=postgres://catraca:catraca@db:5432/catraca`, `GATEWAY_DELAY_SCALE=${GATEWAY_DELAY_SCALE:-1}`, `GATEWAY_POLL_MS=${GATEWAY_POLL_MS:-250}`, `PARTNER_API_KEY=${PARTNER_API_KEY:-catraca-parceiro-2026}`. Healthcheck: `node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"` (intervalo 2 s, timeout 3 s, 60 tentativas, `start_period` 60 s). Sem `env_file`. |
| `compose.gates.yaml` | `name: catraca-gates`. `testdb`: mesma imagem, credenciais e healthcheck do `db` do produto, mas com `tmpfs: /var/lib/postgresql/data`, sem volume e sem portas. O nome é diferente de `db` de propósito: mesmo que alguém rode este arquivo sem `-p`, ele nunca recria o banco do produto. `gates`: `build: { context: ., target: dev }`, `depends_on: { testdb: { condition: service_healthy } }`, `environment: TZ=America/Sao_Paulo, DATABASE_URL=postgres://catraca:catraca@testdb:5432/catraca, NODE_ENV=test`, sem portas. |
| `.github/workflows/gates.yml` | `on: pull_request` e `push: branches: [main]`. Um job `gates` em `ubuntu-latest`: `actions/checkout@v4` + `npm run gates`. |

### 4.5 Seed (dados providos)

| Papel | Nome | E-mail | Senha |
|---|---|---|---|
| organizer | Organizadora A | `org.a@catraca.dev` | `catraca123` |
| organizer | Organizador B | `org.b@catraca.dev` | `catraca123` |
| participant | Participante Seed | `participante@catraca.dev` | `catraca123` |

Chave de parceiro default: `catraca-parceiro-2026`.

### 4.6 README (estrutura entregue por F01)

Seções, nesta ordem e com estes títulos (são os que `check-artifacts.mjs --readme` procura):

1. `## Como rodar`: pré-requisitos (Docker com Compose v2, Git, Node.js LTS); `npm run up`, `npm run down` e `npm run gates`; variáveis `CATRACA_PORT`, `COMPOSE_PROJECT_NAME`, `GATEWAY_DELAY_SCALE`, `PARTNER_API_KEY`; `scripts/burst.sh`; `npm run flow`.
2. `## Endereços`: `$WEB = http://localhost:3000` e `$API = http://localhost:3000` (rotas em `/api/partner/...`). A porta muda com `CATRACA_PORT`.
3. `## Credenciais`: a tabela de §4.5 e a chave `catraca-parceiro-2026` (`X-Api-Key`).
4. `## Mapa dos artefatos`: links para `docs/brief.md`, `docs/PRD.md`, `docs/architecture.md`, as 8 pastas de feature (spec, plano, contrato, relatórios), `state/project-state.json`, `AGENTS.md`, `prompts/`, `docs/final-validation/`. Inclui uma subseção "PRs das waves paralelas" com marcadores `W1: F02 — (link do PR)`, `F03 — (link do PR)`, `W4: F06 — …`, `F07 — …`, preenchidos na Fase 9.
5. `## Decisões`: stack e por quê; R07 sob concorrência (`SELECT … FOR UPDATE` no evento); gateway assíncrono (tabela `payments` + dispatcher); isolamento da avaliação (subagente de contexto vazio e relatórios imutáveis). Texto resumido a partir do PRD §1, completado na Fase 9.

## 5. Interfaces CONSUMIDAS

Nenhuma de outra feature: F01 é a raiz do grafo. Ela consome apenas artefatos pré-existentes: `AGENTS.md`, `CLAUDE.md`, `scripts/check-artifacts.mjs` e `state/project-state.json`.

## 6. Modelo de dados tocado

- Cria **todo** o schema de `architecture.md` §3, literalmente, em `migrations/001_init.sql`: `users`, `sessions`, `events`, `tickets`, `payments`, índices `users_email_lower_uq`, `events_organizer_idx`, `events_status_idx`, `tickets_event_status_idx`, `tickets_user_idx`, `payments_state_idx`. As constraints `CHECK`/`UNIQUE` são declaradas **inline**, para que o Postgres gere os nomes previsíveis usados no contrato: `events_capacity_check`, `events_price_cents_check`, `events_status_check`, `tickets_status_check`, `tickets_price_cents_check`, `tickets_code_key`.
- `schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())` é criada por `migrate.ts` (`CREATE TABLE IF NOT EXISTS`), fora dos arquivos de migração.
- A seed escreve em `users` (3 linhas).

## 7. Regras de negócio citadas

- **R01**: `events.capacity >= 1` e `events.price_cents > 0` no schema (reforço de banco para a validação de F04).
- **R02**: `events.status` ∈ {`draft`, `published`, `cancelled`}, com default `draft`.
- **R03 / R12**: `tickets.price_cents` gravado por ingresso (preço vigente na compra); `formatBRL` para a Receita (`R$ 350,00`, com espaço comum).
- **R05 / R08 / R11**: `tickets.status` ∈ {`pending`, `confirmed`, `declined`, `cancelled`, `refunded`}; `statusLabel` com os rótulos literais do brief (pendente, confirmado, recusado, cancelado, estornado).
- **R09**: `tickets.code` `UNIQUE`; `newTicketCode()` com 8 caracteres `[A-Z2-9]`.
- **R13**: contas de organizador só pela seed; `error.ejs` genérico para 403/404 sem dados.
- Gateway em modo padrão: `GATEWAY_DELAY_SCALE` com default `1` e nenhuma chave de pagamento (brief, "Harness mínimo").

## 8. Casos de erro e mensagens

| Situação | Comportamento |
|---|---|
| Docker Compose v2 ausente em `up.sh` | stderr `Docker Compose v2 é necessário`, saída 1. |
| App não fica saudável em 300 s | `up.sh` imprime as últimas 100 linhas de log do `app` e sai com ≠ 0. |
| Migração falha | O arquivo é revertido (transação) e `node dist/migrate.js` sai com 1. O container não chega a `healthy`. |
| `/healthz` sem banco | `503` `{"ok":false}`. |
| Rota inexistente | `404` `error.ejs`: `Página não encontrada`. |
| Exceção não tratada | `500` `error.ejs`: `Erro interno` (detalhe só no log). |
| `burst.sh` com argumento inválido | `Uso: scripts/burst.sh [rodadas]`, saída 2. |
| `burst.sh` sem o produto no ar ou sem F06 | A rodada imprime `FALHOU` e o script sai com 1. |
| `check-parallel.sh` com < 2 PRs ou sem `gh` | `Uso: scripts/check-parallel.sh <pr> <pr> [...]`, saída 2. |

## 9. Arquivos

**Cria:**
```
package.json  package-lock.json  tsconfig.json  tsconfig.build.json  eslint.config.js  vitest.config.ts  .dockerignore
Dockerfile  compose.yaml  compose.gates.yaml  .github/workflows/gates.yml
scripts/up.sh  scripts/down.sh  scripts/gates.sh  scripts/burst.sh  scripts/check-parallel.sh   (todos com bit executável)
migrations/001_init.sql
src/config.ts  src/db.ts  src/ids.ts  src/format.ts  src/features.ts  src/migrate.ts  src/seed.ts  src/server.ts  src/auth/password.ts
src/views/layout.ejs  src/views/home.ejs  src/views/error.ejs
test/helpers.ts  test/global-setup.ts  test/setup.ts
test/f01/{config,format,ids,password,db,migrate,schema,seed,helpers,http,scripts}.test.ts
```

**Altera:** `README.md` (reescrito com a estrutura de §4.6) e `state/project-state.json` (só a entrada `F01`).

**Não altera:** `AGENTS.md`, `CLAUDE.md`, `docs/**`, `prompts/**`, `scripts/check-artifacts.mjs`, `.gitignore`.

**Pontos de extensão para as próximas features:**
- `src/features.ts`: 1 linha por feature.
- `src/auth/password.ts`: F02 acrescenta `verifyPassword`.
- `test/helpers.ts`: F02 acrescenta `loginAs`.
- `src/views/layout.ejs`: F02 preenche o `<nav data-nav>`.
- `src/server.ts`: F03 inicia o dispatcher.
- `GET /`: F04 registra no próprio plugin.

## 10. Estratégia de testes

- **Unitários (sem banco):** `config` (defaults e leitura de env), `format` (todos os casos de §4.1, inclusive a ausência de U+00A0), `ids` (regex e unicidade em 1 000/10 000 amostras), `password` (formato e salt aleatório).
- **Integração (Postgres efêmero do gates):** `db` (commit/rollback, `pool.options.max === 50`); `migrate` (idempotência, `001_init` registrado uma vez); `schema` (cada invariante violada gera erro com o código `23514`/`23505`/`23502` e o nome da constraint); `seed` (contagens e idempotência em 3 execuções, hash scrypt); `helpers` (defaults e efeitos); `http` via `app.inject()` (`/healthz`, placeholder `/`, 404, ordem de `featurePlugins`, fallback de `GET /`). Os testes do placeholder e do fallback esvaziam `featurePlugins` temporariamente (guardam e restauram o conteúdo em `afterEach`). Assim, continuam válidos depois que F02/F04 acrescentarem plugins, e F04 registra a vitrine em `GET /`.
- **Scripts:** `test/f01/scripts.test.ts` confere o bit executável e o `sh -n` dos 5 scripts. Também confere o uso de `burst.sh --help` e o `check-parallel.sh` com um `gh` falso. O teste cria, num diretório temporário, um `gh` em `sh` que imprime datas fixas por número de PR, e põe esse diretório no início do `PATH`.
- **Harness (manual, no contrato):** clone limpo + `up`, `down`, `up → down → up`, gates sem interferir no produto, dois ambientes simultâneos e CI no PR.
- Nomes exatos dos testes: ver `contract.md`. Os nomes no código precisam ser **idênticos**, porque o avaliador os procura na saída `--reporter=verbose`.

## 11. Questões em aberto

1. **Itens "Fase 9" × veredito do avaliador. RESOLVIDO pelo orquestrador:** C-F01-25 e C-F01-27 saíram do contrato. O AC-F01-09 e o AC-F01-10 do PRD foram reescritos para o que é verificável na avaliação de F01 (C-F01-24 e C-F01-26). A completude final é conferida por `npm run verify:delivery` na Fase 9, fora do veredito de F01.
2. **Defaults dos helpers de teste.** O `architecture.md` não fixa os defaults de `createEvent`/`insertTicket`/`createUser`. Esta spec fixa `createEvent` com status `published` por default (o caso mais comum nos testes de F05–F08), além dos defaults de §4.1. As specs de F04–F08 devem passar `status` explicitamente quando ele importar; convém registrar esses defaults no `architecture.md`.
3. **Substituição da home por F04: conflito com a spec atual de F04.** O `architecture.md` diz que F04 "substitui" `home.ejs` pela vitrine. Esta spec resolve isso sem conflito de arquivo (D12): F04 registra `GET /` no próprio plugin e o placeholder deixa de ser registrado. F04 não precisa editar `server.ts` nem `home.ejs`. Mas a spec de F04 (D14 e a questão em aberto 1 dela) assume o contrário: que F01 registra `GET /` incondicionalmente em `server.ts` e que F04 remove esse registro e **apaga `home.ejs`**. A própria spec de F04 prevê adaptação se F01 usar "só quando nenhuma feature registra `/`". Recomendação: F04 não edita `server.ts` e **não apaga `home.ejs`**. Os testes de F01 C-F01-20 renderizam o placeholder com `featurePlugins` vazio, e apagar o template os quebraria. Se F04 insistir em remover, precisa remover também o fallback em `server.ts` e ajustar `test/f01/http.test.ts` no mesmo PR.
4. **`gates.sh` com argumentos (D6).** É uma extensão do comando do `architecture.md`, necessária para os "testes vitest nomeados executados via gates" (§6 do `architecture.md`). Sem argumentos, o comportamento é exatamente o especificado.
5. **Lint sem `scripts/` (D14).** Necessário porque `scripts/check-artifacts.mjs` (fora do escopo de F01) não passa em `no-sparse-arrays`. Se o orquestrador quiser lint nos scripts, alguém precisa corrigir esse arquivo antes.
6. **Página de erro sem helper.** O `architecture.md` não define helper para 403/404. F01 fixa os locals de `error.ejs` (§4.3) e os títulos. Se quiserem padronizar ainda mais (R13 em F04/F07/F08), dá para acrescentar um helper; não foi incluído para não criar interface fora do `architecture.md`.
7. **Porta do AC-F01-01.** O PRD cita `http://localhost:3000`. O contrato usa `$CATRACA_PORT` (default `3000`), porque o avaliador roda isolado por worktree (`prompts/evaluator.md`). O comportamento com a porta default é o mesmo.
8. **Gates chamados direto, sem `-p` (spec de F03).** A spec/contrato de F03 verifica testes nomeados com `docker compose -f compose.gates.yaml run --rm gates npx vitest run …`, sem `-p`. Com `COMPOSE_PROJECT_NAME` exportado (como no ambiente isolado de avaliação), esse comando cai no **mesmo projeto Compose do produto**. Por isso o banco dos gates se chama `testdb` (D5, §4.4), e não `db`: o comando direto nunca recria o banco do produto. Mesmo assim, ele deixa containers/rede `testdb` no projeto do produto sem `down -v`. O recomendado é que F03 (e todas as features) usem `npm run gates -- <arquivo> -t "<nome>" --reporter=verbose` (D6), que isola o projeto (`<projeto>-gates`) e limpa ao final. O contrato de F03 também assume o serviço `db` em `compose.yaml` com `POSTGRES_USER`/`POSTGRES_DB` = `catraca`, e isso F01 cumpre.
