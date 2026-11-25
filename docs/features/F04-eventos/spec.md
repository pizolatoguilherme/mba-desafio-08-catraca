# Spec — F04 Eventos

- **Feature:** F04 · **Wave:** W2 (sequencial) · **Branch:** `feat/F04-eventos`
- **Consome:** F01 (core, schema, helpers de teste) e F02 (`request.user`, `requireOrganizer`, `loginAs`). Não consome F03.
- **Fontes:** [`docs/brief.md`](../../brief.md) (R01–R05, R13), [`docs/PRD.md`](../../PRD.md) (AC-F04-01…11, XC-F04-F01-01, XC-F04-F02-01), [`docs/architecture.md`](../../architecture.md) §2, §3, §5 (F04), §6, §7.

## 1. Objetivo

Entregar o ciclo de vida do evento do lado do organizador e a vitrine pública:

- criação, edição e publicação, com validação (R01) e com a regra de lotação × vagas ocupadas sob `lockEvent` (R03);
- vitrine `/` e página pública `/events/:id`, só com eventos publicados (R02);
- área `/org/events` com a página de gestão `/org/events/:id` (R04) e os slots vazios de painel, check-in, cancelamento e compra, que F05, F07 e F08 preenchem;
- isolamento por dono (R13);
- as funções de leitura de vagas e de eventos à venda usadas por F05, F06, F07 e F08 (R05).

## 2. Escopo

Dentro:
- `src/events/repo.ts`, `validation.ts`, `manage-sections.ts`, `routes-public.ts`, `routes-org.ts`.
- Views `events/showcase.ejs`, `events/show.ejs`, `org/list.ejs`, `org/new.ejs`, `org/manage.ejs`.
- Partials **vazios** `purchases/_buy.ejs`, `checkin/_panel.ejs`, `checkin/_checkin.ejs`, `cancel/_cancel.ejs`.
- Os guards "evento cancelado não é editável nem publicável" e "`/events/:id` de cancelado → 404", testados com a fixture `createEvent({ status: 'cancelled' })`.
- Testes em `test/f04/`.

Fora:
- Compra, formulário de compra, `Ingressos esgotados` e "Meus ingressos": F05 (F04 só passa `{ event, seats, user }` ao partial `_buy`).
- Check-in e painel: F07. Botão e rota de cancelamento: F08.
- Criação de tickets: os testes de vagas ocupadas usam `insertTicket` (F01).
- Excluir evento e despublicar (fora de escopo pelo PRD §10). Paginação e busca na vitrine.
- API de parceiros (F06), que consome `listOnSaleEvents`.

## 3. Decisões técnicas (e por quê)

| # | Decisão | Por quê |
|---|---|---|
| D1 | Formulário com os campos `name`, `venue`, `startsAt` (`datetime-local`, interpretado em `America/Sao_Paulo` por `parseLocalDateTime`), `capacity` e `price` (`"100,00"` ou `"100.00"`, via `parsePriceToCents`). O `<form>` tem `novalidate` e os inputs não têm `required`/`min`. | Nomes fixados em architecture §5. Sem validação HTML5, a validação do servidor (fonte de verdade) é a que aparece também no navegador, com as mesmas mensagens que o contrato verifica. |
| D2 | Erros de validação → **422**, com o mesmo formulário re-renderizado, os valores enviados preservados e uma mensagem PT-BR por campo em `<p class="field-error" data-error="<campo>">`. | Exigência da tarefa e convenção de contrato: o status e o seletor são verificáveis por `curl` + `grep`. |
| D3 | Sucesso em POST → **303** (`See Other`) para `/org/events/:id`. Não há flash de sucesso. | O padrão PRG evita reenvio. O `Location` estável facilita extrair o id no contrato (`%{redirect_url}`). |
| D4 | Ordem de checagem na edição: (1) dono (`getOwnedEvent`, senão 404); (2) evento `cancelled` → 409; (3) `validateEventInput` → 422; (4) em `withTransaction` + `lockEvent`: dono e status de novo, depois `capacity < occupied` → 422. Só então o `UPDATE`. | R13 primeiro: o não-dono nunca descobre nada, nem o resultado da validação. A releitura sob o lock garante R03 contra compras concorrentes (F05 também usa `lockEvent`). |
| D5 | Rejeição por **estado** (editar/publicar cancelado, publicar não-rascunho) → **409**, com a página de gestão re-renderizada e a mensagem em `<p data-flash="error">`. Nada é alterado. | Diferencia "dados inválidos" (422) de "operação inválida no estado atual" (409). F08 verifica que "POSTs de edição/publicação são rejeitados sem alterar nada". |
| D6 | Evento de outro dono, ou id inexistente, em qualquer rota `/org/events/:id*` → `reply.code(404).view('error.ejs', { status: 404, title: 'Página não encontrada', message: 'O endereço acessado não existe ou não está disponível.' })`, a mesma página que F01 gera para rota inexistente (spec de F01 §4.3), sem nenhum dado do evento. | R13 / AC-F04-08: um 404 indistinguível de "não existe". F01 prescreve esse uso de `error.ejs` para os 404/403 genéricos. |
| D7 | `listOnSaleEvents` e `getPublicEvent` filtram `status = 'published'`. Eventos com data passada **continuam** na vitrine. | O brief (R02) só exclui rascunho e cancelado. O Fluxo do avaliador usa datas futuras. |
| D8 | `getSeatCounts`: `occupied = count(tickets.status IN ('pending','confirmed'))`; `available = status === 'cancelled' ? 0 : max(0, capacity - occupied)`. Para id inexistente, devolve `{ capacity: 0, occupied: 0, available: 0 }`. | R05 literal. O `max(0, …)` protege contra estados herdados. Devolver zeros evita exceção num caminho de leitura. |
| D9 | Toda escrita em `events` (edição e publicação) acontece em `withTransaction` com `lockEvent` (`SELECT … FOR UPDATE`). | PRD §1 (concorrência): edição de lotação/preço e publicação ficam serializadas com compra e cancelamento. |
| D10 | Os partials incluídos recebem **`locals`** inteiro (`<%- include('../checkin/_panel', locals) %>`), que é um superconjunto de `{ event, seats, user }`. Variáveis opcionais nos partials são lidas como `locals.x`. | Os extras que F05 (`purchaseError`), F07 (`checkinResult`, `panel`) e F08 passam via `renderManagePage`/`renderEventPage` precisam chegar aos partials. Ler `locals.x` evita `ReferenceError` quando um extra não existe. |
| D11 | Limites defensivos: `name` e `venue` com ≤ 200 caracteres; `capacity` ≤ 100000; preço ≤ R$ 100.000,00 (10 000 000 centavos). | O brief não fixa limites máximos. Estes impedem estouro de `integer` e entradas absurdas, e nenhum fluxo do brief chega perto deles. |
| D12 | Datas exibidas como `DD/MM/AAAA HH:mm` em `America/Sao_Paulo` (ex.: `25/12/2026 20:00`). No formulário de edição, `value` no formato `datetime-local` (`2026-12-25T20:00`). Preço no formulário como `150,00`; na exibição, `formatBRL` (`R$ 150,00`). | Formato estável e sem vírgula, fácil de comparar no contrato. É o mesmo fuso da decisão do PRD §1. |
| D13 | Marcação com seletores estáveis (`data-event-id`, `data-field`, `data-form`, `data-slot`, `data-error`, `data-seat`, `data-flash`). Cada elemento com `data-field`, `data-seat`, `data-error` ou `data-flash` fica inteiro (abertura, texto e fechamento) numa linha própria do HTML, e o bloco de um evento na vitrine termina em `</li>`. | Verificação por `curl` + `grep`/`sed` sem parser HTML. Os testes usam os mesmos seletores. |
| D14 | `GET /` passa a ser servido por F04 (`routes-public.ts`). F04 **não** edita `src/server.ts` nem `src/views/home.ejs`. | Pela spec de F01 (D12), `buildApp` só registra o placeholder `GET /` (`home.ejs`) se, depois dos `featurePlugins`, nenhuma feature tiver registrado `GET /`. Registrar `/` no plugin de F04 basta, sem conflito de rota nem de arquivo. |
| D15 | Registro em `src/features.ts` numa **única linha**: `/* F04 */ eventsPublicRoutes, eventsOrgRoutes,`. | Convenção de architecture §2 (uma linha por feature). |

## 4. Interfaces PROVIDAS

### 4.1 Assinaturas fixas (architecture §5, sem alteração)

```ts
// src/events/repo.ts
export interface EventRow { id: string; organizer_id: string; name: string; venue: string; starts_at: Date; capacity: number; price_cents: number; status: 'draft'|'published'|'cancelled'; }
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
export async function renderManagePage(reply, event: EventRow, organizerId: string, extra?: Record<string, unknown>): Promise<unknown>;
```

Detalhes de comportamento:
- `listOnSaleEvents(db = pool)`: `ORDER BY starts_at, id`; `available` calculado como em `getSeatCounts`, numa única consulta (`LEFT JOIN tickets … GROUP BY`).
- `getOwnedEvent`: `WHERE id = $1 AND organizer_id = $2` (qualquer status). `getPublicEvent`: `WHERE id = $1 AND status = 'published'`.
- `validateEventInput(form, now = new Date())`: valores não-string (ausentes, arrays de campo duplicado) contam como ausentes; `name`/`venue` passam por `trim()`. `value.name`/`value.venue` são `string`.
- `buildManageLocals(event, organizerId)` devolve `{ event, seats, statusLabel, startsAtLabel, priceLabel, canEdit: event.status !== 'cancelled', canPublish: event.status === 'draft', values, errors: {}, flashError: null, ...seções }`. Aqui, `seats = await getSeatCounts(pool, event.id)` e `values` são os valores do formulário de edição gerados do evento (`startsAt` em `datetime-local`, `price` como `150,00`). Para cada seção registrada, na ordem de registro, o objeto devolvido por `await fn({ event, organizerId })` é **mesclado de forma rasa** nos locals (`Object.assign(locals, retorno)`). Exemplo: a seção `'panel'` de F07 devolve `{ panel: { … } }` e o partial lê `locals.panel`. As chaves de uma seção não devem colidir com as chaves-base acima.
- `registerManageSection(name, fn)`: registrar o mesmo `name` de novo substitui a função.
- `renderManagePage(reply, event, organizerId, extra)` → `reply.view('org/manage.ejs', { ...await buildManageLocals(event, organizerId), user: reply.request.user, ...extra })`. O status HTTP é o que o chamador definiu antes (`reply.code(…)`), e o default é 200. `extra.values`/`extra.errors`/`extra.flashError` sobrepõem os defaults.

### 4.2 Adições de F04 (não divergem da architecture; registrar lá)

```ts
// src/events/repo.ts
export type EventInput = { name: string; venue: string; startsAt: Date; capacity: number; priceCents: number };
export async function listOwnedEvents(organizerId: string): Promise<Array<EventRow & { available: number }>>; // ORDER BY starts_at, id
export async function createOwnedEvent(organizerId: string, v: EventInput): Promise<EventRow>;               // status 'draft', id newId('evt')
export async function updateOwnedEvent(organizerId: string, id: string, v: EventInput):
  Promise<{ ok: true } | { ok: false; error: 'not_found' | 'cancelled' | 'capacity_below_occupied'; occupied?: number }>; // tx + lockEvent
export async function publishOwnedEvent(organizerId: string, id: string):
  Promise<{ ok: true } | { ok: false; error: 'not_found' | 'cancelled' | 'not_draft' }>;                        // tx + lockEvent; status='published', published_at=now()

// src/events/validation.ts
export function formatEventDateTime(d: Date): string;   // "25/12/2026 20:00" (America/Sao_Paulo)
export function toDateTimeLocalValue(d: Date): string;  // "2026-12-25T20:00" (America/Sao_Paulo)
export function centsToPriceInput(cents: number): string; // 15000 -> "150,00"

// src/events/routes-public.ts
export const eventsPublicRoutes: FastifyPluginAsync;
export async function renderEventPage(reply, event: EventRow, extra?: Record<string, unknown>): Promise<unknown>;
  // reply.view('events/show.ejs', { event, seats: await getSeatCounts(pool, event.id), user: reply.request.user, ...extra }); F05 usa para re-renderizar com 409/422

// src/events/routes-org.ts
export const eventsOrgRoutes: FastifyPluginAsync;
```

O `UPDATE` de `updateOwnedEvent` grava `name, venue, starts_at, capacity, price_cents, updated_at = now()` e **não** toca em `tickets` (AC-F04-09).

### 4.3 Rotas

| Método e rota | Guard | Sucesso | Erros |
|---|---|---|---|
| `GET /` | — | 200 `events/showcase.ejs` com `listOnSaleEvents()` | — |
| `GET /events/:id` | — | 200 `events/show.ejs` via `renderEventPage` | 404 genérico se não `published` (rascunho, cancelado, inexistente) |
| `GET /org/events` | `requireOrganizer` | 200 `org/list.ejs` com `listOwnedEvents(user.id)` | visitante 302 `/login?next=…`; participante 403 (F02) |
| `GET /org/events/new` | `requireOrganizer` | 200 `org/new.ejs` (formulário vazio) | idem |
| `POST /org/events/new` | `requireOrganizer` | 303 → `/org/events/<novo id>` | 422 `org/new.ejs` com erros |
| `GET /org/events/:id` | `requireOrganizer` + dono | 200 `renderManagePage` | 404 genérico |
| `POST /org/events/:id` (edição) | `requireOrganizer` + dono | 303 → `/org/events/:id` | 404; 409 cancelado; 422 validação ou lotação < ocupadas |
| `POST /org/events/:id/publish` | `requireOrganizer` + dono | 303 → `/org/events/:id` | 404; 409 cancelado ou não-rascunho |

`POST /org/events/:id/publish` aceita corpo vazio (o formulário não tem campos). O guard das rotas `/org/*` é aplicado como `preHandler: requireOrganizer` em todas elas, inclusive nos POSTs.

### 4.4 Views e seletores (contrato HTML)

`events/showcase.ejs` (`GET /`):
```html
<ul data-list="showcase">
  <li data-event-id="evt_…">
    <a href="/events/evt_…" data-field="name">Jazz no Porão</a>
    <span data-field="startsAt">25/12/2026 20:00</span>
    <span data-field="venue">Bar do Porão</span>
    <span data-field="price">R$ 100,00</span>
    <span data-field="available">2</span>
  </li>
</ul>
<!-- sem eventos: --> <p data-empty>Nenhum evento à venda no momento.</p>
```

`events/show.ejs` (`GET /events/:id`): `<article data-event-id="evt_…">` com os mesmos cinco `data-field` (o nome em `<h1 data-field="name">`) e `<section data-slot="buy"><%- include('../purchases/_buy', locals) %></section>`.

`org/list.ejs`: `<a href="/org/events/new" data-action="new">Novo evento</a>`; `<table data-list="org-events">` com `<tr data-event-id="evt_…" data-event-status="draft|published|cancelled">`, contendo `<a href="/org/events/evt_…" data-field="name">`, `data-field="startsAt"`, `data-field="status"` (rótulo `rascunho`/`publicado`/`cancelado`), `data-field="capacity"` e `data-field="available"`. Sem eventos: `<p data-empty>Você ainda não criou eventos.</p>`.

`org/new.ejs`: `<form method="post" action="/org/events/new" data-form="create" novalidate>` com `<input name="name" value="…">`, `<input name="venue" value="…">`, `<input name="startsAt" value="…" type="datetime-local">`, `<input name="capacity" value="…" inputmode="numeric">` e `<input name="price" value="…" inputmode="decimal" placeholder="100,00">`. Em todos os inputs, os dois primeiros atributos são `name` e `value`, nessa ordem, com o valor vindo de `values`. O formulário de edição segue o mesmo padrão (F08 lê `<input name="capacity" value="…">`). Os erros vão em `<p class="field-error" data-error="<campo>">…</p>`, logo após o input.

`org/manage.ejs` (`GET /org/events/:id`), dentro de `<section data-event-id="evt_…">`:
- `<h1 data-field="name">`, `<code data-field="id">evt_…</code>`, `<span data-field="status" data-event-status="…">rótulo</span>`, `data-field="startsAt"`, `data-field="venue"`, `data-field="price"`;
- vagas: `<dd data-seat="capacity">`, `<dd data-seat="occupied">`, `<dd data-seat="available">`;
- `<p data-flash="error">…</p>` quando `flashError`;
- se `canEdit`: `<form method="post" action="/org/events/evt_…" data-form="edit" novalidate>` com os 5 campos preenchidos (`values`), os `data-error` e o botão `Salvar alterações`;
- se `canPublish`: `<form method="post" action="/org/events/evt_…/publish" data-form="publish"><button>Publicar</button></form>`;
- slots, sempre presentes e nesta ordem:
  ```html
  <section data-slot="panel"><%- include('../checkin/_panel', locals) %></section>
  <section data-slot="checkin"><%- include('../checkin/_checkin', locals) %></section>
  <section data-slot="cancel"><%- include('../cancel/_cancel', locals) %></section>
  ```
- link `<a href="/org/events">Meus eventos</a>`.

Partials vazios criados por F04 (cada um contém só um comentário EJS, que não renderiza nada): `purchases/_buy.ejs` (`<%# F05: formulário de compra %>`), `checkin/_panel.ejs` (`<%# F07: painel %>`), `checkin/_checkin.ejs` (`<%# F07: check-in %>`), `cancel/_cancel.ejs` (`<%# F08: cancelamento %>`).

## 5. Interfaces CONSUMIDAS

De F01:
```ts
pool; query; withTransaction; type Db;                     // src/db.ts
newId('evt');                                              // src/ids.ts
formatBRL; parseLocalDateTime; parsePriceToCents;          // src/format.ts
buildApp({ startDispatcher: false });                      // testes
resetDb; createUser; createEvent; insertTicket;            // test/helpers.ts
```
Também consome o layout `layout.ejs`, a página genérica 404/403 `error.ejs` (locals `{ status, title, message? }`, spec de F01 §4.3), `@fastify/view` e `@fastify/formbody`.

De F02:
```ts
request.user: { id; name; email; role } | null;          // src/auth/plugin.ts
requireOrganizer(req, reply);                             // src/auth/guards.ts — sem user → 302 /login?next=<url>; não organizer → 403
loginAs(app, email, password): Promise<string>;           // test/helpers.ts — devolve o header Cookie
```
Rotas `POST /login` (login nos itens `curl` do contrato) e redirecionamento do organizador para `/org/events` depois do login.

## 6. Modelo de dados tocado

Nenhuma migração.

| Tabela | Operação |
|---|---|
| `events` | `INSERT` (`id`, `organizer_id`, `name`, `venue`, `starts_at`, `capacity`, `price_cents`; `status` default `draft`) |
| `events` | `UPDATE name, venue, starts_at, capacity, price_cents, updated_at` (edição, sob `FOR UPDATE`) |
| `events` | `UPDATE status='published', published_at=now(), updated_at=now()` (publicação, sob `FOR UPDATE`, só a partir de `draft`) |
| `events` | `SELECT` (listas, página, `lockEvent` `FOR UPDATE`) |
| `tickets` | somente leitura (`count` por status em `getSeatCounts` / `listOnSaleEvents` / `listOwnedEvents`) |

As invariantes do schema de F01 (`capacity >= 1`, `price_cents > 0`, `status` ∈ {draft, published, cancelled}, `name`/`venue` não vazios) são a última barreira por trás de `validateEventInput` (XC-F04-F01-01).

## 7. Regras citadas

- **R01** — campos, lotação inteira ≥ 1, preço > 0, data futura na criação e na edição (AC-F04-01, 02, 10; XC-F04-F01-01).
- **R02** — nasce rascunho; só publicado e não cancelado aparece na vitrine (AC-F04-03, 04).
- **R03** — lotação ≥ vagas ocupadas; mudança de preço só para compras futuras (AC-F04-06, 09).
- **R04** — página de gestão com URL própria (AC-F04-05, 11).
- **R05** — vagas ocupadas e disponíveis, 0 em cancelado (AC-F04-07).
- **R11** (preparação para F08) — cancelado não é editável nem republicável e sai da vitrine (guards de F04, verificados aqui por fixture).
- **R13** — organizador só vê e opera os próprios eventos; participante e visitante fora da área (AC-F04-08, XC-F04-F02-01).

## 8. Casos de erro e mensagens (PT-BR, literais)

Validação (`validateEventInput`), status **422**, chave = nome do campo:

| Campo | Condição | Mensagem |
|---|---|---|
| `name` | ausente, não-string ou vazio após `trim` | `Informe o nome do evento.` |
| `name` | mais de 200 caracteres | `O nome deve ter no máximo 200 caracteres.` |
| `venue` | ausente, não-string ou vazio após `trim` | `Informe o local do evento.` |
| `venue` | mais de 200 caracteres | `O local deve ter no máximo 200 caracteres.` |
| `startsAt` | ausente ou vazio | `Informe a data e hora de início.` |
| `startsAt` | `parseLocalDateTime` devolve `null` | `Data e hora de início inválidas.` |
| `startsAt` | `≤ now` | `A data de início precisa estar no futuro.` |
| `capacity` | ausente ou vazio | `Informe a lotação.` |
| `capacity` | não casa `^-?\d+$` (ex.: `2.5`, `abc`) | `A lotação deve ser um número inteiro.` |
| `capacity` | inteiro < 1 (ex.: `0`, `-1`) | `A lotação deve ser de pelo menos 1.` |
| `capacity` | inteiro > 100000 | `A lotação deve ser de no máximo 100000.` |
| `price` | ausente ou vazio | `Informe o preço.` |
| `price` | casa `^-?\d+([.,]\d{1,2})?$` e o valor é ≤ 0 (ex.: `0`, `0,00`, `-5`) | `O preço deve ser maior que zero.` |
| `price` | qualquer outro valor que `parsePriceToCents` não aceite (ex.: `abc`, `10,999`) | `Preço inválido. Use o formato 100,00.` |
| `price` | > 10000000 centavos | `O preço deve ser de no máximo R$ 100.000,00.` |

Regra de negócio e estado:

| Situação | Status | Onde aparece | Mensagem |
|---|---|---|---|
| Edição com lotação < vagas ocupadas | 422 | `data-error="capacity"` no formulário de edição | `A lotação não pode ser menor que as vagas ocupadas (<N>).` (ex.: `(2)`) |
| Edição de evento cancelado | 409 | `data-flash="error"` na página de gestão | `Evento cancelado não pode ser editado.` |
| Publicação de evento cancelado | 409 | `data-flash="error"` | `Evento cancelado não pode ser publicado.` |
| Publicação de evento já publicado | 409 | `data-flash="error"` | `O evento já está publicado.` |
| Evento de outro dono ou inexistente (`/org/events/:id`, edição, publicação) | 404 | página genérica de F01 | (texto genérico de `error.ejs`, sem dados do evento) |
| `/events/:id` rascunho, cancelado ou inexistente | 404 | página genérica de F01 | idem |
| Visitante em `/org/*` | 302 | `Location: /login?next=…` | (F02) |
| Participante em `/org/*` | 403 | `error.ejs` | (F02, sem dado de evento) |

Nos casos 409 e 422 de edição/publicação, nada é gravado (`updated_at` inalterado).

## 9. Arquivos

Cria:
- `src/events/repo.ts`, `src/events/validation.ts`, `src/events/manage-sections.ts`, `src/events/routes-public.ts`, `src/events/routes-org.ts`
- `src/views/events/showcase.ejs`, `src/views/events/show.ejs`
- `src/views/org/list.ejs`, `src/views/org/new.ejs`, `src/views/org/manage.ejs`
- `src/views/purchases/_buy.ejs`, `src/views/checkin/_panel.ejs`, `src/views/checkin/_checkin.ejs`, `src/views/cancel/_cancel.ejs` (vazios)
- `test/f04/_support.ts` (helpers locais: `postForm(app, url, cookie, fields)`, `futureLocal(days)`, `pastLocal()`, `field(html, eventId, name)`)
- `test/f04/validation.test.ts`, `repo.test.ts`, `public.test.ts`, `org.test.ts`, `manage.test.ts`, `edit.test.ts`, `publish.test.ts`

Altera:
- `src/features.ts` — uma linha: `/* F04 */ eventsPublicRoutes, eventsOrgRoutes,` (+ import).
- `state/project-state.json` — somente a entrada `F04`.

Não altera: `src/server.ts` e `src/views/home.ejs` (D14), `src/auth/*`, `src/gateway/*`, `test/helpers.ts`, `migrations/`, `layout.ejs`, `error.ejs`.

## 10. Estratégia de testes

- **Unidade:** `validation.test.ts` com tabela de casos (cada linha da §8, inclusive campo ausente e campo duplicado), conversões (`"100,00"` e `"100.00"` → 10000; `startsAt` local → instante UTC correto) e `now` injetado para a data passada. Os formatadores (`formatEventDateTime`, `toDateTimeLocalValue`, `centsToPriceInput`) também são testados aqui.
- **Repositório (Postgres real):** `getSeatCounts` com tickets de todos os status (fixture `insertTicket`) e com evento cancelado (fixture `createEvent({ status: 'cancelled' })`); filtros de `listOnSaleEvents`, `getOwnedEvent` e `getPublicEvent`; `lockEvent` bloqueando uma segunda transação.
- **HTTP (`app.inject` com `buildApp({ startDispatcher: false })` e `loginAs`):** vitrine, página pública, lista, criação, gestão, edição e publicação, sempre conferindo status, seletores HTML e o estado do banco depois da operação.
- **Concorrência determinística:**
  - um cliente segura `lockEvent`, a edição via `inject` fica bloqueada, o cliente insere tickets e faz commit, e a edição passa a ver as vagas novas (R03 sob lock);
  - duas publicações simultâneas resultam em exatamente uma 303 e uma 409.
- **Produto no ar (contrato):** `curl` com cookie jar contra `http://localhost:$CATRACA_PORT`, login via `POST /login` com as contas da seed, e `psql` no container `db` para conferir o banco e inserir tickets/eventos de fixture.
- Os nomes dos testes não têm metacaracteres de regex, para que `vitest -t "<nome>"` os selecione exatamente.

## 11. Questões em aberto

1. **Placeholder `GET /` de F01 (D14).** Resolvido pela spec de F01 (D12): o placeholder só é registrado se nenhuma feature registrou `GET /`. Se o código de F01 na `main` divergir disso (o arranque falharia com rota duplicada), o implementador de F04 faz a remoção mínima do placeholder em `src/server.ts` e a registra no PR.
2. **Adições de interface (§4.2).** `listOwnedEvents`, `createOwnedEvent`, `updateOwnedEvent`, `publishOwnedEvent`, `EventInput`, os formatadores, `renderEventPage`, `eventsPublicRoutes` e `eventsOrgRoutes` não estão em architecture §5. São aditivas, mas convém registrá-las lá. `renderEventPage` existe para que F05 re-renderize `show.ejs` com 409/422 sem duplicar o cálculo de `seats`.
3. **Partials recebem `locals` (D10).** A architecture diz "inclui `purchases/_buy.ejs` com `{ event, seats, user }`". F04 passa `locals` (superconjunto), senão os extras de F05/F07/F08 não chegam aos partials. F05, F07 e F08 precisam ler variáveis opcionais como `locals.x`.
4. **Status 409 para rejeição por estado (D5).** O PRD/architecture só diz "rejeitado". F08 deve esperar **409** (página de gestão com `data-flash="error"`) para edição/publicação de evento cancelado, e 404 para não-dono.
5. **Limites máximos (D11)** não vêm do brief: são decisões defensivas deste spec.
6. **Eventos passados (D7)** continuam na vitrine se estiverem publicados. Se o time preferir escondê-los, isso muda R02/F06 e precisa entrar no PRD.
7. **`parsePriceToCents` de F01.** A spec decide as mensagens de preço por padrão de texto (§8), sem depender de F01 devolver `0` ou `null` para `"0,00"`. Exige apenas que `parsePriceToCents` aceite `"100,00"`, `"100.00"` e `"100"`.
8. **Valores do formulário depois de um 422 de edição.** Num 422 (ex.: lotação menor que as ocupadas), o formulário re-renderizado mostra os valores **enviados**, como é o padrão de formulário. O valor **gravado** aparece em `data-seat="capacity"` e num novo `GET /org/events/:id`. O fluxo de F08 (passo 9: "`<input name="capacity">` com valor `2`" depois da edição rejeitada) precisa ler a página com um GET novo, não o corpo do 422.
9. **Formato do retorno das seções.** O retorno de `registerManageSection` é mesclado de forma rasa (§4.1), como a spec de F07 supõe (`{ panel: {…} }` → `locals.panel`). A architecture não fixa isso; convém registrar lá.
