# Arquitetura compartilhada — Catraca

> Documento de referência para **todas** as specs. Ele fixa schema, layout de pastas, interfaces entre features, rotas e nomes de campos, para que features implementadas em paralelo se encaixem. Uma mudança aqui exige atualizar as specs afetadas.

## 1. Stack e execução

- Node.js 22 (container `node:22-alpine`), TypeScript (ESM, `"module": "NodeNext"`), Fastify 5, `@fastify/view` + EJS, `@fastify/formbody`, `@fastify/cookie`, `pg` (SQL explícito, sem ORM).
- PostgreSQL 16 (`postgres:16-alpine`), não exposto no host.
- Testes: vitest, com testes de integração contra Postgres real (o gates sobe um Postgres efêmero) e `app.inject()` para HTTP.
- Lint/typecheck: ESLint (flat config, typescript-eslint) + `tsc --noEmit`.
- `TZ=America/Sao_Paulo` em todos os containers.

### Harness
| Comando | Implementação |
|---|---|
| `npm run up` | `scripts/up.sh` → `docker compose up -d --build --wait` (app com healthcheck em `/healthz`; o entrypoint roda `node dist/migrate.js && node dist/seed.js && node dist/server.js`) |
| `npm run down` | `scripts/down.sh` → `docker compose down --remove-orphans` |
| `npm run gates` | `scripts/gates.sh` → `docker compose -p "${COMPOSE_PROJECT_NAME:-catraca}-gates" -f compose.gates.yaml up --build --abort-on-container-exit --exit-code-from gates`, depois `down -v`. O container `gates` (stage `dev` do Dockerfile) roda `npm run gates:inner` = `npm run lint && npm run typecheck && npm run test` |
| `npm run flow` | `node scripts/flow/evaluator-flow.mjs` (entregue por F08) |
| `npm run verify:delivery` | `node scripts/check-artifacts.mjs --all` |

Variáveis (todas com default): `CATRACA_PORT=3000`, `COMPOSE_PROJECT_NAME=catraca`, `DATABASE_URL` (montada pelo compose), `GATEWAY_DELAY_SCALE=1`, `PARTNER_API_KEY=catraca-parceiro-2026`, `GATEWAY_POLL_MS=250`.

## 2. Layout de pastas

```
src/
  server.ts            F01  buildApp() + start (listen)
  config.ts            F01  leitura de env com defaults
  db.ts                F01  pool, query, withTransaction
  ids.ts               F01  newId(prefix), newTicketCode()
  format.ts            F01  formatBRL, toIsoWithOffset, parseLocalDateTime, parsePriceToCents, statusLabel
  features.ts          F01  lista de plugins de feature (cada feature acrescenta 1 linha)
  migrate.ts, seed.ts  F01
  auth/                F02  plugin.ts (request.user), guards.ts, password.ts, routes.ts
  gateway/             F03  card.ts, simulated.ts, dispatcher.ts, index.ts
  events/              F04  repo.ts, validation.ts, manage-sections.ts, routes-public.ts, routes-org.ts
  purchases/           F05  service.ts, routes.ts
  partner/             F06  plugin.ts
  checkin/             F07  service.ts, panel.ts, routes.ts
  cancel/              F08  service.ts, routes.ts
  views/
    layout.ejs, home.ejs, error.ejs                          F01 (home = placeholder; F04 substitui pela vitrine)
    auth/{login,signup}.ejs                                  F02
    events/{showcase,show}.ejs                               F04
    org/{list,new,manage}.ejs                                F04
    purchases/_buy.ejs, purchases/my-tickets.ejs             F05 (F04 cria _buy.ejs vazio)
    checkin/_checkin.ejs, checkin/_panel.ejs                 F07 (F04 cria vazios)
    cancel/_cancel.ejs                                       F08 (F04 cria vazio)
migrations/001_init.sql  F01 (schema completo)
test/
  helpers.ts           F01 (+ F02 adiciona loginAs)
  f01/… f08/…          testes de cada feature
scripts/  up.sh down.sh gates.sh burst.sh check-artifacts.mjs check-parallel.sh flow/evaluator-flow.mjs
compose.yaml  compose.gates.yaml  Dockerfile  .github/workflows/gates.yml
```

**Registro de features:** `src/features.ts` exporta `export const featurePlugins: FastifyPluginAsync[] = [ /* F02 */ authPlugin, … ]`. Cada feature acrescenta **uma linha**; um conflito aqui é trivial de resolver. O `buildApp` registra `featurePlugins` em ordem, depois do core.

## 3. Schema (`migrations/001_init.sql`, entregue por F01)

```sql
CREATE TABLE users (
  id            text PRIMARY KEY,                       -- usr_xxxxxxxxxx
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,                          -- scrypt$<salt hex>$<hash hex>
  role          text NOT NULL CHECK (role IN ('participant','organizer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE sessions (
  id         text PRIMARY KEY,                          -- 32 bytes random base64url
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id           text PRIMARY KEY,                        -- evt_xxxxxxxxxx
  organizer_id text NOT NULL REFERENCES users(id),
  name         text NOT NULL CHECK (length(trim(name)) > 0),
  venue        text NOT NULL CHECK (length(trim(venue)) > 0),
  starts_at    timestamptz NOT NULL,
  capacity     integer NOT NULL CHECK (capacity >= 1),
  price_cents  integer NOT NULL CHECK (price_cents > 0),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  cancelled_at timestamptz
);
CREATE INDEX events_organizer_idx ON events (organizer_id);
CREATE INDEX events_status_idx ON events (status);

CREATE TABLE tickets (
  id            text PRIMARY KEY,                       -- tkt_xxxxxxxxxx
  event_id      text NOT NULL REFERENCES events(id),
  user_id       text REFERENCES users(id),              -- null para canal partner
  buyer_email   text NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('web','partner')),
  code          text NOT NULL UNIQUE,                   -- 8 chars [A-Z2-9]
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','declined','cancelled','refunded')),
  price_cents   integer NOT NULL CHECK (price_cents > 0), -- preço vigente na compra
  card_last4    text NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
  checked_in_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);
CREATE INDEX tickets_user_idx ON tickets (user_id);

CREATE TABLE payments (
  id           bigserial PRIMARY KEY,
  ticket_id    text NOT NULL UNIQUE REFERENCES tickets(id),
  card_last4   text NOT NULL,
  state        text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','in_flight','done')),
  result       text CHECK (result IN ('approved','declined')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  completed_at timestamptz
);
CREATE INDEX payments_state_idx ON payments (state);
```

O controle de migrações usa a tabela `schema_migrations(version text PRIMARY KEY, applied_at timestamptz)`, e `migrate.ts` aplica os arquivos de `migrations/` em ordem lexicográfica.

## 4. Seed (F01, idempotente: upsert por e-mail)

| Papel | Nome | E-mail | Senha |
|---|---|---|---|
| Organizador A | Organizadora A | `org.a@catraca.dev` | `catraca123` |
| Organizador B | Organizador B | `org.b@catraca.dev` | `catraca123` |
| Participante | Participante Seed | `participante@catraca.dev` | `catraca123` |

A chave de parceiro default é `catraca-parceiro-2026` (env `PARTNER_API_KEY`). F01 entrega `hashPassword` em `src/auth/password.ts` (scrypt), porque a seed precisa dela. F02 consome o mesmo módulo e o amplia com `verifyPassword`.

## 5. Interfaces entre features (assinaturas fixas)

### F01 — core
```ts
// src/config.ts
export interface Config { port: number; databaseUrl: string; gatewayDelayScale: number; gatewayPollMs: number; partnerApiKey: string; }
export const config: Config;
// src/db.ts
export const pool: pg.Pool;                                   // max 50 conexões
export function query<T>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
export function withTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T>;  // BEGIN/COMMIT/ROLLBACK
export type Db = pg.Pool | pg.PoolClient;
// src/ids.ts
export function newId(prefix: 'usr'|'evt'|'tkt'): string;       // prefix + '_' + 10 chars [a-z0-9]
export function newTicketCode(): string;                          // 8 chars [A-Z2-9] (sem 0,1,O,I)
// src/format.ts
export function formatBRL(cents: number): string;                 // 35000 -> "R$ 350,00" (espaço comum)
export function toIsoWithOffset(d: Date): string;                 // "2026-12-05T21:00:00-03:00"
export function parseLocalDateTime(s: string): Date | null;       // "2026-12-05T21:00" em America/Sao_Paulo
export function parsePriceToCents(s: string): number | null;      // "100,00" | "100.00" | "100" -> 10000; inválido -> null
export function statusLabel(s: TicketStatus): string;             // pending->"pendente", confirmed->"confirmado", ...
export type TicketStatus = 'pending'|'confirmed'|'declined'|'cancelled'|'refunded';
// src/server.ts
export async function buildApp(opts?: { startDispatcher?: boolean }): Promise<FastifyInstance>;
// test/helpers.ts
export async function resetDb(): Promise<void>;                   // TRUNCATE de todas as tabelas (exceto schema_migrations) + seed
export async function createUser(p: { role: 'participant'|'organizer'; email?: string; password?: string; name?: string }): Promise<{ id: string; email: string; password: string }>;
export async function createEvent(p: { organizerId: string; status?: 'draft'|'published'|'cancelled'; capacity?: number; priceCents?: number; startsAt?: Date; name?: string; venue?: string }): Promise<{ id: string }>;
export async function insertTicket(p: { eventId: string; status?: TicketStatus; priceCents?: number; channel?: 'web'|'partner'; userId?: string|null; buyerEmail?: string; code?: string; checkedIn?: boolean }): Promise<{ id: string; code: string }>;
```
O `buildApp` registra `@fastify/formbody`, `@fastify/cookie`, `@fastify/view` (root `src/views`, layout `layout.ejs`), `GET /healthz` (`{"ok":true}`, depois de um `SELECT 1`), as páginas 404/403 genéricas (`error.ejs`) e, em seguida, `featurePlugins`. O dispatcher de F03 é iniciado em `server.ts` (F03 acrescenta isso). Nos testes, `buildApp({ startDispatcher: false })`.

### F02 — auth
```ts
// src/auth/plugin.ts  (registrado via features.ts; usa fastify-plugin para decorar a instância raiz)
declare module 'fastify' { interface FastifyRequest { user: { id: string; name: string; email: string; role: 'participant'|'organizer' } | null } }
// src/auth/guards.ts
export async function requireOrganizer(req, reply): Promise<void>; // sem user -> 302 /login?next=<url>; não organizer -> 403 error.ejs
export async function requireParticipant(req, reply): Promise<void>; // sem user -> 302 /login?next=<url>; organizer -> 403
// src/auth/password.ts
export function hashPassword(p: string): Promise<string>;  export function verifyPassword(p: string, h: string): Promise<boolean>;
// test/helpers.ts (F02 acrescenta)
export async function loginAs(app: FastifyInstance, email: string, password: string): Promise<string>; // devolve o header Cookie
```
Rotas: `GET/POST /signup` (campos `name`, `email`, `password`), `GET/POST /login` (`email`, `password`, `next`), `POST /logout` (e `GET /logout` por conveniência). Cookie `sid`: HttpOnly, SameSite=Lax, Path=/, 7 dias. Depois do login, o organizador vai para `/org/events` e o participante vai para `next` ou `/`. O layout mostra o usuário logado e um botão "Sair".

### F03 — gateway
```ts
// src/gateway/card.ts
export function isValidCardNumber(v: unknown): v is string;   // /^\d{16}$/
export function cardLast4(card: string): string;
// src/gateway/simulated.ts
export type GatewayResult = 'approved'|'declined';
export interface PaymentGateway { authorize(cardLast4: string): Promise<GatewayResult>; }
export function decide(cardLast4: string, rnd?: () => number): { result: GatewayResult; delayMs: number }; // tabela; delays em escala 1
export class SimulatedGateway implements PaymentGateway { constructor(opts: { scale: number; rnd?: () => number }); }
// src/gateway/dispatcher.ts
export async function enqueuePayment(c: Db, ticketId: string, cardLast4: string): Promise<void>; // INSERT em payments (na transação do chamador)
export async function applyGatewayResult(ticketId: string, result: GatewayResult): Promise<boolean>; // tx: SELECT events FOR SHARE; UPDATE tickets ... WHERE status='pending' AND evento não cancelado; payments -> done
export interface Dispatcher { start(): void; stop(): Promise<void>; kick(): void; idle(): Promise<void>; }
export function createDispatcher(opts: { gateway: PaymentGateway; pollMs: number }): Dispatcher;
// src/gateway/index.ts
export const dispatcher: Dispatcher;   // singleton (SimulatedGateway com config.gatewayDelayScale)
```
O dispatcher roda um laço a cada `pollMs`, e também quando recebe `kick()`. Ele faz `UPDATE payments SET state='in_flight' … WHERE id IN (SELECT id FROM payments WHERE state='requested' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100) RETURNING *`. Para **cada** linha, dispara sem `await` em série: `gateway.authorize(last4).then(r => applyGatewayResult(ticketId, r))`. No `start()`, linhas `in_flight` voltam a `requested` (há uma única instância de app).

### F04 — eventos
```ts
// src/events/repo.ts
export interface EventRow { id; organizer_id; name; venue; starts_at: Date; capacity: number; price_cents: number; status: 'draft'|'published'|'cancelled'; }
export async function lockEvent(c: pg.PoolClient, id: string): Promise<EventRow | null>;          // SELECT … FOR UPDATE
export async function getSeatCounts(db: Db, eventId: string): Promise<{ capacity: number; occupied: number; available: number }>; // available = cancelled ? 0 : max(0, capacity - occupied)
export async function listOnSaleEvents(db?: Db): Promise<Array<EventRow & { available: number }>>; // status='published', ordenado por starts_at
export async function getOwnedEvent(organizerId: string, id: string): Promise<EventRow | null>;
export async function getPublicEvent(id: string): Promise<EventRow | null>;                        // só published
// src/events/validation.ts
export function validateEventInput(form: Record<string, unknown>, now?: Date): { ok: true; value: { name; venue; startsAt: Date; capacity: number; priceCents: number } } | { ok: false; errors: Record<string,string> };
// src/events/manage-sections.ts
export type ManageSection = (ctx: { event: EventRow; organizerId: string }) => Promise<Record<string, unknown>>;
export function registerManageSection(name: string, fn: ManageSection): void;   // F07 registra 'panel'
export async function buildManageLocals(event: EventRow, organizerId: string): Promise<Record<string, unknown>>;
export async function renderManagePage(reply, event: EventRow, organizerId: string, extra?: Record<string, unknown>): Promise<unknown>; // usado por F07/F08 para re-renderizar com mensagem
```
Rotas:

- `GET /`: vitrine com eventos `published`, cada um com link `/events/:id`.
- `GET /events/:id`: 404 se não `published`. Inclui `purchases/_buy.ejs` com `{ event, seats, user }`.
- `GET /org/events`: lista do dono.
- `GET/POST /org/events/new`: criação. Campos `name`, `venue`, `startsAt` (datetime-local), `capacity`, `price`.
- `GET /org/events/:id`: página de gestão. Mostra id, dados, vagas, formulário de edição (mesmos campos), botão publicar (se `draft`) e os includes `checkin/_panel.ejs`, `checkin/_checkin.ejs` e `cancel/_cancel.ejs`.
- `POST /org/events/:id`: edição.
- `POST /org/events/:id/publish`: publicação.

Todas as rotas `/org/*` usam `requireOrganizer`. Evento de outro dono → 404 `error.ejs`.

Edição e publicação acontecem sob `lockEvent`. Edição é rejeitada se `status='cancelled'`, e publicação só é aceita a partir de `draft`. Esses guards ficam em F04 e são verificados em F08. A página de gestão de evento cancelado não mostra formulário de edição nem botão publicar.

### F05 — compras
```ts
// src/purchases/service.ts
export type PurchaseError = 'invalid_request'|'event_not_available'|'sold_out';
export function validatePurchaseInput(i: { buyerEmail: unknown; cardNumber: unknown }): { ok: true } | { ok: false; error: 'invalid_request' };
export async function purchaseTicket(i: { eventId: string; channel: 'web'|'partner'; userId?: string|null; buyerEmail: string; cardNumber: string }):
  Promise<{ ok: true; ticket: { id: string; code: string; status: 'pending'; eventId: string } } | { ok: false; error: PurchaseError }>;
  // ordem: validatePurchaseInput -> withTransaction{ lockEvent; status!=='published' => event_not_available; getSeatCounts(c) available<=0 => sold_out; INSERT ticket(price_cents = event.price_cents) ; enqueuePayment } -> dispatcher.kick()
export async function findTicketById(id: string): Promise<TicketRow | null>;
export async function listTicketsForUser(userId: string): Promise<Array<TicketRow & { event_name: string }>>;
```
Rotas:

- `POST /events/:id/purchase` (`requireParticipant`), campo `cardNumber`. Em caso de sucesso, 303 para `/me/tickets`. Sem vaga, re-renderiza `show.ejs` com status 409 e o texto `Ingressos esgotados`. Cartão inválido → 422 com mensagem.
- `GET /me/tickets` (`requireParticipant`): tabela com evento, status (`statusLabel`) e código. Cada linha tem `data-ticket-code="<code>"` e `data-ticket-status="<valor api>"`.

`_buy.ejs`: se `seats.available === 0`, mostra `Ingressos esgotados` **no lugar** do formulário. Senão, mostra o formulário (ou um link "Entre para comprar" para visitante).

### F06 — API de parceiros
Plugin com prefixo `/api/partner`, encapsulado (sem `fastify-plugin`):

- `onRequest` faz a checagem da chave, com comparação timing-safe.
- Um content-type parser próprio aceita qualquer `Content-Type` (ou nenhum) como texto.
- O handler faz o `JSON.parse` e responde 422 se falhar.
- O `setErrorHandler` do escopo converte qualquer erro de validação/parsing em `422 invalid_request` e erros inesperados em 500 com JSON.

A API consome `listOnSaleEvents`, `purchaseTicket`, `validatePurchaseInput` e `findTicketById`.

### F07 — check-in & painel
```ts
// src/checkin/service.ts
export const CHECKIN_MESSAGES = { invalid: 'Ingresso inválido para este evento', cancelled: 'Evento cancelado', notConfirmed: 'Ingresso não confirmado', used: 'Ingresso já utilizado', ok: 'Entrada liberada' } as const;
export async function checkIn(eventId: string, rawCode: string): Promise<keyof typeof CHECKIN_MESSAGES>; // tx: ticket FOR UPDATE por (code normalizado, event_id) ; ordem R10
// src/checkin/panel.ts
export async function getPanel(db: Db, eventId: string): Promise<{ confirmed; pending; checkins; available; revenueCents; refunded }>;
```
Rotas e views:

- `POST /org/events/:id/checkin` (`requireOrganizer` + dono, senão 404), campo `code`. Re-renderiza a página de gestão via `renderManagePage(..., { checkinResult })`. A mensagem vai em `<p data-checkin-result>`.
- `_panel.ejs` mostra os 6 números com `data-metric`.
- F07 registra `registerManageSection('panel', …)`.

### F08 — cancelamento
```ts
// src/cancel/service.ts
export async function cancelEvent(organizerId: string, eventId: string): Promise<{ ok: true } | { ok: false; error: 'not_found'|'not_cancellable' }>;
  // tx: lockEvent; dono? ; status==='published' ; UPDATE events SET status='cancelled' ; UPDATE tickets SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled' END, updated_at=now() WHERE event_id=$1 AND status IN ('confirmed','pending')
```
Rota `POST /org/events/:id/cancel` → 303 para `/org/events/:id`. `_cancel.ejs` mostra o botão "Cancelar evento" só se `status='published'`, e o aviso "Evento cancelado" se `status='cancelled'`. F08 entrega também `scripts/flow/evaluator-flow.mjs` (`npm run flow`), que roda os passos 2–16 do Fluxo do avaliador contra `$WEB`.

## 6. Convenções de contrato (todas as features)

- `contract.md` tem três seções:
  1. `## Pré-requisitos de ambiente`: comandos, `COMPOSE_PROJECT_NAME`/`CATRACA_PORT`, seed, estado inicial.
  2. `## Itens verificáveis`: cada item `C-Fxx-nn` traz o **como verificar** (comando exato, requisição `curl`, teste vitest nomeado `npx vitest run test/fxx/<arquivo> -t "<nome>"` executado via gates, ou inspeção de HTML com seletor) e o **resultado esperado** observável.
  3. `## Mapeamento PRD → contrato`: uma linha por critério, no formato `- AC-Fxx-nn → C-Fxx-01, C-Fxx-02`. Inclui todos os AC da feature e os XC que a feature cobre (ver PRD §6).
- Itens que dependem de dados que outra feature ainda não cria (ex.: tickets antes de F05, evento cancelado antes de F08) são verificados por **fixture** (`insertTicket`, `createEvent({status:'cancelled'})`) em testes nomeados. A verificação real fica nos XC das consumidoras.
- Atrasos do gateway: os testes automatizados podem usar `GATEWAY_DELAY_SCALE` < 1. Itens de tempo real ("≤ 5 s", "30–40 s") são verificados com a escala 1 contra o produto no ar (`npm run up`).
- Verificações por HTTP usam `curl` com cookie jar (`-c/-b`) contra `http://localhost:$CATRACA_PORT`, e formulários com `-d` (`application/x-www-form-urlencoded`).

## 7. Convenções de plano

- O `plan.md` tem etapas numeradas e pequenas (cada uma vale um commit), cada etapa com o teste que a acompanha.
- A etapa 1 é sempre um esqueleto pequeno, commitado e enviado logo no início, para comprovar o paralelismo nas waves paralelas.
- A última etapa roda os itens do contrato como fumaça, roda `npm run gates`, atualiza `state/project-state.json` (só a própria feature) e abre o PR.

## 8. Complementos decididos na Fase 2 (consolidação das specs)

As specs foram escritas em paralelo e levantaram as questões abaixo. Estas decisões valem para todas as features e prevalecem sobre qualquer divergência.

| # | Tema | Decisão |
|---|---|---|
| 1 | Testes nomeados | `npm run gates -- <arquivo> -t "<nome>" --reporter=verbose` roda só o vitest selecionado no compose isolado de gates (F01). Os nomes de teste começam com o ID do item de contrato (`C-Fxx-nn …`). O wrapper `vt` dos contratos de F07/F08 é equivalente. |
| 2 | Banco dos gates | O serviço se chama `testdb` em `compose.gates.yaml`, com projeto `${COMPOSE_PROJECT_NAME:-catraca}-gates`, e nunca toca no banco do produto. |
| 3 | Placeholder `GET /` | `buildApp` só registra o `home.ejs` placeholder se nenhuma feature registrar `GET /`. F04 registra `/` no próprio plugin e não edita `server.ts` nem `home.ejs`. |
| 4 | Guard global `/org` | F02 aplica `requireOrganizer` a `/org` e `/org/*` com um hook global e cria `GET /org` → 302 `/org/events`. F04 não registra `GET /org`. |
| 5 | Status HTTP | Validação de formulário → **422**, com o formulário re-renderizado. Conflito de estado (editar/publicar evento cancelado, cancelar evento não publicado) → **409**, sem alterar nada. Evento de outro dono / inexistente → **404** `error.ejs`. A criação de evento responde **303** com `Location: /org/events/evt_…`, e as ações bem-sucedidas (editar, publicar, cancelar) respondem **303** para `/org/events/:id`. |
| 6 | Seções da página de gestão | `registerManageSection(name, fn)`: o objeto retornado por `fn` é **mesclado de forma rasa** nos locals (`fn` retorna `{ panel }` → `locals.panel`). Os partials recebem os `locals` completos da página. |
| 7 | Funções adicionais de F04 | `listOwnedEvents`, `createOwnedEvent`, `updateOwnedEvent`, `publishOwnedEvent`, `EventInput`, `renderEventPage(reply, event, extra?, statusCode?)`, `eventsPublicRoutes`, `eventsOrgRoutes` (conforme a spec de F04). |
| 8 | Funções adicionais de F05 | `TicketRow` (exportado de `src/purchases/service.ts`), `findTicketByCode(code)`. "Meus ingressos" acrescenta `data-ticket-id`. `GET /events/:id/purchase` → redirect para `/events/:id`. |
| 9 | Script de F03 | `src/gateway/enqueue-demo.ts` (→ `dist/gateway/enqueue-demo.js`), usado só na avaliação de F03 (XC-F03-F01-01). |
| 10 | Dispatcher | Iniciado em `buildApp` no hook `onReady` (se `startDispatcher !== false`) e parado no `preClose`. `kick()` com o dispatcher parado não faz nada. |
| 11 | Roteador | F01 configura `routerOptions.maxParamLength = 500` no Fastify e um `frameworkErrors` que, para caminhos `/api/partner/*`, responde `422 {"error":"invalid_request"}` em vez do 400 padrão (URL malformada). |
| 12 | Content-Type da API | O parser de F06 aceita qualquer Content-Type (nunca 415). O handler de compra exige `application/json` (com charset opcional); fora disso → 422. |
| 13 | Ordem de locks | Sempre o **evento primeiro**, depois o ticket: compra/edição/cancelamento usam `FOR UPDATE` no evento; `applyGatewayResult` e `checkIn` usam `FOR SHARE` no evento e depois `FOR UPDATE` no ticket. |
| 14 | Defaults dos helpers | `createEvent` default: `status='published'`, `capacity=10`, `priceCents=10000`, `startsAt` = agora + 30 dias. `insertTicket` default: `status='pending'`, `channel='web'`, `priceCents` = preço do evento. |
| 15 | Dependências npm | Todas entram no `package.json` de F01. Nas waves paralelas, F02/F03 e F06/F07 não alteram `package.json`. |
| 16 | Lint | O ESLint cobre `src/` e `test/`. `scripts/*.mjs` é verificado com `node --check` dentro dos gates. |
