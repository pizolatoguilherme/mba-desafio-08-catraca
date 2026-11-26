# Spec — F07 Check-in & Painel

- **Feature:** F07, Check-in & Painel
- **Wave:** W4 (em **paralelo** com F06, API de parceiros). As duas não dependem uma da outra.
- **Branch:** `feat/F07-checkin-painel`
- **Consome:** F02 (guards, `request.user`), F04 (página de gestão, `registerManageSection`, `renderManagePage`, `getOwnedEvent`, `getSeatCounts`, edição de evento), F05 (`purchaseTicket`, tickets com `price_cents` e `code`). F01 (db, format, helpers de teste) chega de forma transitiva.
- **Regras do brief:** R10 (check-in), R12 (painel), R05 (vagas disponíveis), R03 (preço vigente na compra), R13 (acesso), R07 (rajada no painel).
- **Critérios do PRD:** AC-F07-01 … AC-F07-07, XC-F07-F02-01, XC-F07-F04-01, XC-F07-F05-01, XC-F07-F05-02, XC-F07-F05-03.

## 1. Objetivo

Na página de gestão de um evento (`/org/events/:id`, de F04), o organizador dono:

1. informa o código de um ingresso e vê **exatamente uma** das cinco mensagens de R10, escolhida pela **primeira** situação verdadeira, na ordem do brief;
2. vê o painel de R12 com os seis números (Confirmados, Pendentes, Check-ins, Vagas disponíveis, Receita, Estornados), contando as vendas dos canais `web` e `partner` e calculando a receita com o preço gravado em cada ingresso.

A feature tem de funcionar quando se encontra com as outras: códigos de qualquer canal, preço alterado depois de compras e rajadas de compra simultâneas.

## 2. Escopo

**Dentro:**
- `checkIn(eventId, rawCode)` e `CHECKIN_MESSAGES` em `src/checkin/service.ts`.
- `getPanel(db, eventId)` em `src/checkin/panel.ts`.
- Plugin `checkinPlugin` em `src/checkin/routes.ts`: a rota `POST /org/events/:id/checkin` e o registro da seção de gestão `'panel'`.
- Preenchimento dos partials `src/views/checkin/_panel.ejs` e `src/views/checkin/_checkin.ejs`, que F04 cria vazios.
- Testes em `test/f07/`.

**Fora de escopo:**
- Uso da API HTTP de parceiros (F06 é paralela). Tickets do canal `partner` vêm de `purchaseTicket({ channel: 'partner' })` (F05) ou de `insertTicket({ channel: 'partner' })` (fixture).
- Cancelamento de evento (F08). O caso `Evento cancelado` é verificado com a fixture `createEvent({ status: 'cancelled' })` + `insertTicket`.
- Desfazer check-in, check-in em lote, leitor de QR code, atualização em tempo real (recarregar basta) e exportação do painel.
- Qualquer alteração em `src/events/*`, `src/purchases/*`, `src/partner/*`, `src/gateway/*` ou `test/helpers.ts`.
- Migrações: o schema de F01 já tem tudo (`tickets.checked_in_at`, `tickets.code UNIQUE`).

## 3. Decisões técnicas (com o porquê)

| # | Decisão | Por quê |
|---|---|---|
| D1 | `checkIn` roda em `withTransaction`. Primeiro faz `SELECT status FROM events WHERE id = $1 FOR SHARE`, depois `SELECT id, status, checked_in_at FROM tickets WHERE code = $1 AND event_id = $2 FOR UPDATE` e, se o resultado for `ok`, `UPDATE tickets SET checked_in_at = now(), updated_at = now() WHERE id = $1`. | O `FOR UPDATE` no ticket serializa check-ins concorrentes do mesmo código. Sem ele, em READ COMMITTED, duas transações leriam `checked_in_at IS NULL` e as duas responderiam `Entrada liberada`. O `FOR SHARE` no evento serializa o check-in com o cancelamento de F08, que segura `FOR UPDATE` no evento. Assim, um check-in nunca libera entrada num evento que acabou de ser cancelado. A ordem dos locks (evento → ticket) é a mesma do cancelamento e de `applyGatewayResult`, então não há deadlock. |
| D2 | Ordem de R10 implementada literalmente, nesta sequência: (1) ticket não encontrado para `(code, event_id)` → `invalid`; (2) `events.status = 'cancelled'` → `cancelled`; (3) `tickets.status <> 'confirmed'` → `notConfirmed`; (4) `checked_in_at IS NOT NULL` → `used`; (5) senão → `ok` e grava `checked_in_at`. Evento inexistente também resulta em `invalid`. | R10 manda usar a **primeira** situação verdadeira. Buscar por `(code, event_id)` faz com que o código de outro evento caia em (1) mesmo que o evento atual esteja cancelado. |
| D3 | Normalização do código: `rawCode.trim().toUpperCase()`. Entrada que não é string, ou vazia depois do trim, resulta em `invalid` sem consultar o banco. A consulta é parametrizada. | AC-F07-07. Os códigos são gerados em `[A-Z2-9]` (F01, `newTicketCode`), então maiúsculas bastam. Espaços internos não são removidos. |
| D4 | O campo de check-in fica **sempre visível** na página de gestão, inclusive em evento cancelado. | R10 permite as duas opções. Com o campo disponível vale a lista, e é isso que AC-F07-01 testa. O aviso de evento cancelado no lugar do formulário de edição é de F08 (`cancel/_cancel.ejs`). |
| D5 | `getPanel` faz **uma** consulta agregada em `tickets` (`COUNT(*) FILTER (WHERE …)` e `COALESCE(SUM(price_cents) FILTER (WHERE status = 'confirmed'), 0)`, com cast `::int`) e obtém `available` de `getSeatCounts(db, eventId)` de F04. | Receita = soma do `price_cents` gravado em cada ingresso confirmado (R03/R12), nunca `events.price_cents × n`. O cast evita que o `pg` devolva `bigint` como string. Usar `getSeatCounts` garante XC-F07-F04-01 (o painel e F04 usam a mesma definição de R05, com 0 em evento cancelado). |
| D6 | O painel é calculado a cada renderização da página de gestão, sem cache. | Recarregar a página basta (fora de escopo: tempo real). Sem cache, não existe número velho. |
| D7 | `POST /org/events/:id/checkin` responde **200** re-renderizando a página de gestão via `renderManagePage(reply, event, organizerId, { checkinResult, checkinResultKey })`, sem redirect. | A mensagem precisa aparecer na resposta e o projeto não tem flash/sessão de mensagens. Como a página é re-renderizada, o painel já vem com Check-ins atualizado. Reenviar o formulário só gera `Ingresso já utilizado`, o que é inofensivo. |
| D8 | Marcação estável. A mensagem fica em `<p data-checkin-result="<chave>">Mensagem</p>`, onde a chave é `ok`, `used`, `notConfirmed`, `cancelled` ou `invalid`. Cada número fica em um elemento com `data-metric="confirmed|pending|checkins|available|revenue|refunded"` que contém **somente** o valor como texto, sem tags aninhadas. O rótulo fica em um elemento irmão. | Contratos, `npm run flow` (F08) e testes extraem os números com `data-metric="x"[^>]*>([^<]*)<`. A chave em `data-checkin-result` é um extra e não substitui o texto literal. |
| D9 | A receita é formatada com `formatBRL` (F01): `35000 → "R$ 350,00"`, com espaço comum (U+0020) e nunca NBSP ou `&nbsp;`. | AC-F07-04 e passo 9 do brief. |
| D10 | Dono do evento: a rota usa `requireOrganizer` (F02) e depois `getOwnedEvent(req.user.id, id)` (F04). Se o resultado for `null`, responde 404 genérico pelo mesmo mecanismo que F04 usa para "evento de outro dono" e **não chama** `checkIn`. | R13 / AC-F07-06. Assim, o check-in nunca acontece em evento alheio e a resposta não vaza dados. `checkIn(eventId, …)` não faz checagem de dono: quem garante isso é a rota. |
| D11 | Nos testes, a confirmação de pagamentos usa um dispatcher **local**, `createDispatcher({ gateway: new SimulatedGateway({ scale }), pollMs })` (F03), iniciado e parado no próprio teste, com `buildApp({ startDispatcher: false })`. Para estados que não exigem o caminho real, a confirmação usa `applyGatewayResult(ticketId, 'approved')`. | Torna o teste independente do `GATEWAY_DELAY_SCALE` do ambiente de gates e permite rodar a rajada de XC-F07-F05-03 em **escala 1** dentro dos gates. F03 é consumida só nos testes, de forma transitiva via F05. |

## 4. Interfaces

### 4.1 Providas (assinaturas fixas do `docs/architecture.md` §5)

```ts
// src/checkin/service.ts
export const CHECKIN_MESSAGES = {
  invalid: 'Ingresso inválido para este evento',
  cancelled: 'Evento cancelado',
  notConfirmed: 'Ingresso não confirmado',
  used: 'Ingresso já utilizado',
  ok: 'Entrada liberada',
} as const;
export async function checkIn(eventId: string, rawCode: string): Promise<keyof typeof CHECKIN_MESSAGES>;
  // tx: evento FOR SHARE ; ticket FOR UPDATE por (code normalizado, event_id) ; ordem R10 ; 'ok' grava checked_in_at

// src/checkin/panel.ts
export async function getPanel(db: Db, eventId: string): Promise<{
  confirmed: number; pending: number; checkins: number; available: number; revenueCents: number; refunded: number;
}>;

// src/checkin/routes.ts
export const checkinPlugin: FastifyPluginAsync;   // acrescentado em src/features.ts (1 linha)
```

Rotas e views:
- `POST /org/events/:id/checkin` (`requireOrganizer` + dono, senão 404), campo de formulário `code`. Responde 200 com a página de gestão re-renderizada, que contém `<p data-checkin-result="<chave>">…</p>` e o painel atualizado.
- `registerManageSection('panel', fn)`: `fn({ event })` devolve `{ panel: { confirmed, pending, checkins, available, revenueCents, revenue } }`, em que `revenue = formatBRL(revenueCents)`.
- `src/views/checkin/_panel.ejs`: os 6 números com `data-metric`.
- `src/views/checkin/_checkin.ejs`: o formulário `<form method="post" action="/org/events/<id>/checkin">` com `<input name="code">` e o botão "Fazer check-in". Se `locals.checkinResult` existir, mostra `<p data-checkin-result="<%= locals.checkinResultKey %>"><%= locals.checkinResult %></p>`.

Nos partials, os valores opcionais são lidos via `locals.x`, porque uma variável EJS ausente lança `ReferenceError`.

### 4.2 Consumidas

| De | Interface | Uso |
|---|---|---|
| F01 | `withTransaction`, `query`, `pool`, `Db` (`src/db.ts`) | transação do check-in; consulta do painel |
| F01 | `formatBRL` (`src/format.ts`) | Receita |
| F01 | `resetDb`, `createUser`, `createEvent`, `insertTicket` (`test/helpers.ts`) | fixtures (inclusive `createEvent({ status: 'cancelled' })`) |
| F01 | `buildApp({ startDispatcher: false })` | `app.inject()` nos testes |
| F02 | `requireOrganizer`, `request.user`, `loginAs` | guard da rota; cookies nos testes |
| F04 | `getOwnedEvent(organizerId, id)` | dono do evento na rota |
| F04 | `getSeatCounts(db, eventId)` | `available` do painel |
| F04 | `registerManageSection`, `renderManagePage`, `buildManageLocals` | seção `'panel'` e re-renderização com mensagem |
| F04 | `POST /org/events/:id` (edição) | testes de XC-F07-F04-01 / XC-F07-F05-01 (mudança de lotação e preço) |
| F05 | `purchaseTicket({ eventId, channel, userId?, buyerEmail, cardNumber })` | tickets reais dos canais `web` e `partner` nos testes |
| F05 | `POST /events/:id/purchase` | itens ao vivo do contrato (compra pela vitrine) |
| F03 (só testes) | `createDispatcher`, `SimulatedGateway`, `applyGatewayResult` | confirmação/recusa controlada |

## 5. Modelo de dados

Sem migração. Usa o schema de F01:

- `tickets.code` (UNIQUE, `[A-Z2-9]{8}`). A busca é por `code = $1 AND event_id = $2` e usa o índice único de `code`.
- `tickets.status` ∈ {pending, confirmed, declined, cancelled, refunded} e `tickets.checked_in_at` (timestamptz, null = sem check-in). O check-in grava `checked_in_at = now()` e `updated_at = now()` e **não** muda `status`.
- `tickets.price_cents`: preço vigente no momento da compra (gravado por F05).
- `events.status`, `events.capacity`: lidos (o evento com `FOR SHARE` no check-in; a lotação via `getSeatCounts`).

Definições do painel (R12), todas restritas a `event_id = $1`:

| Métrica | `data-metric` | Rótulo | Definição SQL |
|---|---|---|---|
| Confirmados | `confirmed` | Confirmados | `status = 'confirmed'` (inclui os que já passaram pelo check-in) |
| Pendentes | `pending` | Pendentes | `status = 'pending'` |
| Check-ins | `checkins` | Check-ins | `status = 'confirmed' AND checked_in_at IS NOT NULL` |
| Vagas disponíveis | `available` | Vagas disponíveis | `getSeatCounts(db, eventId).available` (R05; 0 se cancelado) |
| Receita | `revenue` | Receita | `formatBRL(COALESCE(SUM(price_cents) FILTER (WHERE status = 'confirmed'), 0))` |
| Estornados | `refunded` | Estornados | `status = 'refunded'` |

Um ingresso `refunded` que tinha check-in **não** conta em Check-ins (R12: "confirmados que já passaram pelo check-in").

## 6. Regras citadas

- **R10:** ordem 1–5 e mensagens literais. Em evento cancelado o campo continua disponível (D4), então vale a lista.
- **R12:** as seis definições acima, vendas da vitrine e da API.
- **R05:** Vagas disponíveis = lotação − (pending + confirmed), 0 em evento cancelado.
- **R03:** a mudança de preço vale só para compras posteriores, por isso a receita usa `tickets.price_cents`.
- **R13:** só o dono opera check-in e vê o painel. Outro organizador recebe 404 sem dados, participante recebe 403 e visitante é redirecionado para `/login`.
- **R07:** depois de uma rajada, o painel nunca mostra mais confirmados que a lotação.

## 7. Mensagens e rótulos literais

Copiados de `docs/brief.md` (não traduzir, não mudar acentos nem caixa):

| Chave | Mensagem |
|---|---|
| `invalid` | `Ingresso inválido para este evento` |
| `cancelled` | `Evento cancelado` |
| `notConfirmed` | `Ingresso não confirmado` |
| `used` | `Ingresso já utilizado` |
| `ok` | `Entrada liberada` |

Rótulos do painel: `Confirmados`, `Pendentes`, `Check-ins`, `Vagas disponíveis`, `Receita`, `Estornados`. Formato da receita: `R$ 350,00`, `R$ 0,00` (com `formatBRL`).

Rótulos do formulário (livres; não são verificados como literais): título "Check-in", campo "Código do ingresso", botão "Fazer check-in".

## 8. Arquivos

**Cria:**
- `src/checkin/service.ts`: `CHECKIN_MESSAGES`, `checkIn`, `normalizeCode` (export interno, usado nos testes).
- `src/checkin/panel.ts`: `getPanel`.
- `src/checkin/routes.ts`: `checkinPlugin` (rota + `registerManageSection('panel', …)` na inicialização do plugin).
- `test/f07/support.ts`: `startTestDispatcher(scale, pollMs?)` e `waitFor(fn, timeoutMs, stepMs?)`, locais de F07.
- `test/f07/checkin.service.test.ts`, `test/f07/panel.test.ts`, `test/f07/routes.test.ts`, `test/f07/cross.test.ts`, `test/f07/burst.test.ts`.

**Altera:**
- `src/views/checkin/_panel.ejs` e `src/views/checkin/_checkin.ejs`: preenche os arquivos vazios criados por F04.
- `src/features.ts`: acrescenta **uma** linha (`checkinPlugin`).
- `state/project-state.json`: **só** a entrada `F07`.

**Não toca:** `src/events/**`, `src/purchases/**`, `src/partner/**` (F06, paralela), `src/gateway/**`, `src/views/org/manage.ejs`, `src/views/cancel/_cancel.ejs`, `test/helpers.ts`, `migrations/**`.

Conflitos esperados com F06 (mesma wave), triviais de resolver no rebase: a linha acrescentada em `src/features.ts` e as linhas vizinhas `F06`/`F07` em `state/project-state.json`.

## 9. Estratégia de testes

Todos os testes usam vitest contra Postgres real (o gates sobe um efêmero), com `resetDb()` em `beforeEach`, `buildApp({ startDispatcher: false })` e `app.inject()`. **O nome de cada teste começa com o ID do item de contrato** (ex.: `C-F07-08 confirmado → Entrada liberada e grava checked_in_at`), para que `-t "C-F07-08"` o selecione. Os nomes não usam caracteres especiais de regex (`$ ( ) [ ] ? + * .`).

| Arquivo | Cobre |
|---|---|
| `checkin.service.test.ts` | mensagens literais; ordem R10 com fixtures (inclui evento cancelado por fixture); normalização; concorrência (10 check-ins simultâneos do mesmo código → exatamente 1 `ok` e 9 `used`, repetido 10 rodadas) |
| `panel.test.ts` | definições de `getPanel` com um mix de fixtures; `formatBRL` / ausência de NBSP; HTML do painel com `data-metric` |
| `routes.test.ts` | `POST /org/events/:id/checkin`: dono (200 + `data-checkin-result`), outro organizador (404 sem dados, nada gravado), participante (403), visitante (302 `/login`) |
| `cross.test.ts` | XC-F07-F04-01 (lotação 2 → 3 pela rota de edição de F04); XC-F07-F05-01 (cenário do passo 9 com `purchaseTicket` dos dois canais e dispatcher local); XC-F07-F05-02 (códigos de F05 de cada canal) |
| `burst.test.ts` | XC-F07-F05-03: 30 `purchaseTicket` simultâneos (`partner`, `0001`) em evento de lotação 5, dispatcher local em **escala 1**. O painel mostra Confirmados 5 e Vagas 0 em ≤ 10 s. Timeout do teste: 30 s |

Itens de tempo real (escala 1, gateway de verdade do produto) são verificados contra o produto no ar (`npm run up`) com `curl` + cookie jar, usando a compra pela **vitrine** (F05). A rajada pelo canal `partner` via HTTP fica no `npm run flow` de F08 (passo 15).

## 10. Questões em aberto

1. **Formato de `buildManageLocals` (F04).** A spec supõe que os objetos devolvidos pelas seções sejam mesclados de forma rasa nos locals da página (`locals.panel`). Se F04 tiver aninhado o resultado pelo nome da seção, o implementador de F07 lê `src/events/manage-sections.ts` na `main` e ajusta **só** o retorno da seção ou o `_panel.ejs`, sem alterar F04. O contrato verifica o HTML, não a forma interna.
2. **Locals nos partials.** A spec supõe que `manage.ejs` (F04) inclua `checkin/_panel.ejs` e `checkin/_checkin.ejs` herdando os locals da página (`event` e o `extra` de `renderManagePage`). Isso é o comportamento padrão do `include` do EJS. Se F04 passar dados explícitos, F07 ajusta a leitura nos partials.
3. **Lock extra no evento.** O architecture.md descreve o check-in como "tx: ticket FOR UPDATE por (code normalizado, event_id)". Esta spec acrescenta, antes, `SELECT … FROM events … FOR SHARE` (D1), para serializar com o cancelamento de F08. A assinatura não muda. É uma decisão interna, registrada aqui para F08 conhecer a ordem dos locks.
4. **`findTicketByCode`.** O PRD (tabela de features) diz que F05 provê `findTicketByCode`, mas o architecture.md §5 não o lista. F07 **não depende dele**: a busca por código precisa acontecer dentro da transação, com `FOR UPDATE` e filtro por `event_id`, então F07 faz a própria consulta.
5. **Execução de teste nomeado.** O contrato usa `docker compose -f compose.gates.yaml run --rm gates npx vitest run …` (ver pré-requisitos). Se F01 tiver exposto outro atalho equivalente (ex.: argumento extra em `scripts/gates.sh`), ele vale igualmente. A evidência é a linha `✓` do teste.
6. **Redirect da criação de evento (F04).** Os helpers `curl` do contrato extraem o id do evento do cabeçalho `Location` de `POST /org/events/new`, supondo que F04 redirecione para `/org/events/evt_…`. Se não redirecionar, o fallback é procurar o link `/org/events/evt_…` do nome único em `GET /org/events`.

## 11. Notas de implementação (registradas pelo implementador)

1. **Questões 1 e 2 (§10):** confirmadas na `main`. `buildManageLocals` mescla o retorno das seções de forma rasa (`locals.panel`) e `manage.ejs` inclui os partials com os `locals` completos da página. Nada de F04 foi alterado.
2. **Partials e o teste C-F04-19 de F04:** `test/f04/manage.test.ts` renderiza os partials com `{ event: {}, seats: {}, user: null }` e espera saída vazia. Por isso `_panel.ejs` só renderiza com `locals.panel` presente, e `_checkin.ejs` só renderiza com `locals.event.id` presente (sem id de evento não há `action` possível). Na página de gestão real os dois sempre aparecem (inclusive em evento cancelado, D4). Nenhum teste de outra feature foi alterado.
3. **`src/features.ts`:** além da linha `/* F07 */ checkinPlugin,` no array, entra a linha de `import` correspondente (indispensável para referenciar o plugin).
4. **Campo `code` ausente ou não-string no POST:** tratado como string vazia, o que resulta em `Ingresso inválido para este evento` (D3), sem consultar o banco.
5. **Formulário:** o `<input name="code">` não usa `required`, para que um envio vazio receba a mensagem de R10 do servidor.
6. **Questão 5 (§10):** o atalho de F01 `npm run gates -- <arquivo> -t "<nome>" --reporter=verbose` (architecture §8 #1) é equivalente ao wrapper `vt`.
