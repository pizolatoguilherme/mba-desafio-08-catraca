# Spec — F08 Cancelamento

- **Feature:** F08, Cancelamento (feature **integradora**)
- **Wave:** W5 (sequencial). Começa com F01–F07 `done` na `main`.
- **Branch:** `feat/F08-cancelamento`
- **Consome:** F03 (guarda do resultado do gateway, dispatcher), F04 (página de gestão, `lockEvent`, guards de edição/publicação, vitrine, `getSeatCounts`), F05 (`purchaseTicket`, "Meus ingressos"), F06 (API de parceiros), F07 (check-in e painel). F01/F02 chegam de forma transitiva.
- **Regras do brief:** R11 (cancelamento), R02, R05, R08, R09, R10, R12, R13.
- **Critérios do PRD:** AC-F08-01 … AC-F08-07, XC-F08-F03-01, XC-F08-F04-01, XC-F08-F05-01, XC-F08-F06-01, XC-F08-F06-02, XC-F08-F07-01.

## 1. Objetivo

1. Permitir que o organizador dono cancele um evento **publicado**, de forma irreversível (R11). Numa única transação, o evento vira `cancelled`, os ingressos `confirmed` viram `refunded` e os `pending` viram `cancelled`. Respostas do gateway que cheguem depois não mudam nada.
2. Provar que o cancelamento vale **quando as features se encontram**: vitrine e API (F04/F06), compra (F05), gateway assíncrono (F03), check-in e painel (F07).
3. Entregar `scripts/flow/evaluator-flow.mjs` (`npm run flow`), que executa os passos 2–16 do Fluxo do avaliador do brief contra o produto no ar, com asserts exatos e tempos reais. Entregar também a versão em escala reduzida desse fluxo dentro dos gates.

## 2. Escopo

**Dentro:**
- `cancelEvent` em `src/cancel/service.ts`.
- Plugin `cancelPlugin` em `src/cancel/routes.ts` com `POST /org/events/:id/cancel`.
- Preenchimento de `src/views/cancel/_cancel.ejs`, que F04 cria vazio.
- Teste de corrida cancelamento × respostas do gateway (AC-F08-02).
- Testes cross-feature com F03–F07 já integradas.
- `scripts/flow/evaluator-flow.mjs`, a declaração de tipos `scripts/flow/evaluator-flow.d.mts` e o teste de integração do fluxo em escala reduzida.

**Fora de escopo:**
- Cancelamento ou transferência de ingresso pelo participante (fora de escopo do brief).
- "Descancelar", despublicar ou excluir evento.
- Estorno financeiro real: `refunded` é só um status.
- Notificação a compradores.
- Mudar os guards de edição/publicação de F04 (F04 já rejeita edição de evento `cancelled` e só publica a partir de `draft`). F08 **verifica** esses guards; não os reimplementa.
- Migrações (o schema de F01 tem `events.cancelled_at`).
- `scripts/burst.sh` (passo 15 via `curl`/`xargs`), que não é de F08.

## 3. Decisões técnicas (com o porquê)

| # | Decisão | Por quê |
|---|---|---|
| D1 | `cancelEvent` roda em `withTransaction`. Os passos são: `lockEvent(c, eventId)` (`SELECT … FOR UPDATE`); se a linha não existe ou `organizer_id ≠ organizerId` → `not_found`; se `status ≠ 'published'` → `not_cancellable`; `UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`; e **um único** `UPDATE tickets SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled' END, updated_at = now() WHERE event_id = $1 AND status IN ('confirmed','pending')`. | AC-F08-02. O `FOR UPDATE` no evento serializa o cancelamento com `purchaseTicket` (que também trava o evento), com `applyGatewayResult` (`FOR SHARE` no evento, F03) e com `checkIn` (`FOR SHARE` no evento, F07). Um único `UPDATE` com `CASE` garante que nenhum ticket fique para trás entre dois comandos. O efeito é imediato, bem dentro dos 10 s de R11. |
| D2 | `not_found` cobre tanto o evento inexistente quanto o de outro dono. | R13: a resposta não pode revelar que o evento existe. |
| D3 | `payments` não é tocado. Pagamentos `requested`/`in_flight` seguem para o gateway, e `applyGatewayResult` (F03) os marca `done` **sem** alterar o ticket, porque o evento está `cancelled` e o ticket já não está `pending`. | R11: "resposta do gateway que chegue depois não muda o status". Essa guarda é de F03 (AC-F03-05). F08 prova a guarda na integração (XC-F08-F03-01) e na corrida (AC-F08-02), e não duplica a lógica. |
| D4 | Rota `POST /org/events/:id/cancel` com `requireOrganizer` (F02). As respostas são: `ok` → `303 Location: /org/events/:id`; `not_found` → 404 genérico (mesmo mecanismo de F04 para evento de outro dono); `not_cancellable` → **409**, com a página de gestão re-renderizada via `renderManagePage(reply, event, user.id, { cancelError })`. | O architecture.md fixa o 303 de sucesso. O 409 com mensagem torna a rejeição observável sem alterar nada (AC-F08-01). |
| D5 | `_cancel.ejs` tem três casos. Com `event.status === 'published'`, mostra `<form method="post" action="/org/events/<id>/cancel" data-cancel-form><button type="submit">Cancelar evento</button></form>`. Com `event.status === 'cancelled'`, mostra `<p data-event-cancelled>Evento cancelado</p>`. Com `draft`, não mostra nada. Se `locals.cancelError` existir, mostra `<p data-cancel-error>…</p>`. | AC-F08-01 e AC-F08-04. Sem JavaScript e sem passo de confirmação (MVP; qualidade visual fora de escopo). Os opcionais são lidos via `locals.x`. |
| D6 | O campo de check-in continua disponível em evento cancelado (decisão de F07), então o check-in de um código de evento cancelado mostra `Evento cancelado` em `data-checkin-result`. | Vale a lista de R10. XC-F08-F07-01 é verificado pela mensagem do check-in. O aviso de D5 é complementar. |
| D7 | `scripts/flow/evaluator-flow.mjs` é Node 22 puro, **sem dependências**. Usa `fetch` com `redirect: 'manual'`, um cookie jar manual por ator (`headers.getSetCookie()`), formulários `application/x-www-form-urlencoded` e regex no HTML (`data-metric`, `data-checkin-result`, `data-ticket-code`/`data-ticket-status`, `<input name="capacity">`). Exporta `runFlow(opts)` e, executado diretamente, roda o `main()` (CLI). | Roda na máquina do avaliador, que só tem Node LTS, sem `npm install`. A mesma função serve ao CLI e ao teste dos gates. |
| D8 | Cada execução do fluxo usa um sufixo único (`runId = Date.now().toString(36)`) nos nomes dos eventos e nos e-mails. Nenhum assert depende de banco vazio. | Permite rodar `npm run flow` várias vezes contra o mesmo produto, sem reset. |
| D9 | O fluxo tem a escala `FLOW_SCALE` (default `1`). Prazos superiores ("em até 5 s/10 s") valem `ms × scale + slack`, e esperas mínimas ("passados 45 s") valem `ms × scale + slack`, com `slack = 0` em escala 1 e `1000 ms` em escala < 1. Janelas "antes de 30 s" valem `30 s × scale`. | Em escala 1 (o `npm run flow`), os tempos são **exatamente** os do brief. A escala reduzida existe só para o teste de integração nos gates, em que o produto roda com dispatcher a `scale` igual. |
| D10 | Passo 15 no fluxo: 30 `fetch` simultâneos (`Promise.all`) para `POST $API/api/partner/events/$E/purchases`, contando os status. | Equivale aos 30 `curl` paralelos do brief sem depender de `xargs`/`curl`. O `undici` do Node abre conexões em paralelo. |
| D11 | Rejeições de edição (passos 9 e 13) são verificadas **pelo efeito**: valor de `capacity` no formulário, `priceCents`/`availableSeats` na API e nome na página. O status HTTP só precisa não ser 5xx. | O architecture.md não fixa o status HTTP da rejeição de edição de F04. O que o brief exige é que a edição seja rejeitada. |
| D12 | O teste de corrida (AC-F08-02) tem 20 rodadas. Em cada uma, um evento novo de lotação 40 recebe 20 tickets `pending` criados por `purchaseTicket` (com `startDispatcher: false`, os pagamentos ficam `requested`). Depois roda `Promise.all([cancelEvent(...), ...20 × applyGatewayResult(id, aprovado|recusado aleatório)])`, com as chamadas embaralhadas e atrasos aleatórios de 0–5 ms. | Exercita as duas ordens possíveis (resposta antes ou depois do lock do cancelamento). Ao final, nenhum ticket fica `confirmed` ou `pending`. |

## 4. Interfaces

### 4.1 Providas (assinaturas fixas do `docs/architecture.md` §5)

```ts
// src/cancel/service.ts
export async function cancelEvent(organizerId: string, eventId: string):
  Promise<{ ok: true } | { ok: false; error: 'not_found' | 'not_cancellable' }>;
  // tx: lockEvent ; dono? ; status==='published' ; UPDATE events SET status='cancelled' ;
  //     UPDATE tickets SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled' END,
  //     updated_at=now() WHERE event_id=$1 AND status IN ('confirmed','pending')

// src/cancel/routes.ts
export const cancelPlugin: FastifyPluginAsync;   // acrescentado em src/features.ts (1 linha)
```

- Rota `POST /org/events/:id/cancel`: `303 → /org/events/:id` | `404` | `409` (D4).
- View `src/views/cancel/_cancel.ejs` (D5).

```ts
// scripts/flow/evaluator-flow.mjs  (tipos em scripts/flow/evaluator-flow.d.mts)
export async function runFlow(opts: {
  web: string; api: string; key: string;
  scale?: number;                       // default 1
  log?: (line: string) => void;         // default console.log
}): Promise<{ ok: true; steps: Array<{ step: number; ms: number; title: string }> }
         | { ok: false; step: number; error: string; steps: Array<{ step: number; ms: number; title: string }> }>;
```

CLI (`npm run flow` = `node scripts/flow/evaluator-flow.mjs`):
- Variáveis de ambiente, todas com default:
  - `WEB`: `http://localhost:${CATRACA_PORT:-3000}`;
  - `API`: igual a `$WEB`;
  - `KEY`: `$PARTNER_API_KEY` ou `catraca-parceiro-2026`;
  - `FLOW_SCALE`: `1`; valores menores só nos testes.
- Antes do passo 2, faz uma pré-checagem (`GET $WEB/healthz` → 200).
- Saída:
  - uma linha `PASS passo N — <título> [x.x s]` por passo;
  - na primeira falha, `FAIL passo N — <esperado> / <obtido>` e `exit 1`;
  - ao final, `FLOW OK — passos 2–16 (escala S) em T s` e `exit 0`;
  - um erro inesperado (rede etc.) também gera `FAIL` + `exit 1`.

### 4.2 Consumidas

| De | Interface | Uso |
|---|---|---|
| F01 | `withTransaction`, `query`, `pool`, `buildApp`, `config`, `statusLabel`, `formatBRL`; `resetDb`, `createUser`, `createEvent`, `insertTicket` | serviço, testes |
| F02 | `requireOrganizer`, `loginAs`, `/login`, `/signup` | guard da rota; testes; fluxo |
| F03 | `applyGatewayResult`, `createDispatcher`, `SimulatedGateway` | corrida; resposta atrasada; dispatcher local nos testes e no teste do fluxo |
| F04 | `lockEvent`, `getOwnedEvent`, `getSeatCounts`, `listOnSaleEvents`, `renderManagePage`; rotas `/`, `/events/:id`, `/org/events`, `/org/events/new`, `/org/events/:id` (GET/POST), `/org/events/:id/publish` | serviço, rota, testes, fluxo |
| F05 | `purchaseTicket`, `findTicketById`, `listTicketsForUser`; rotas `POST /events/:id/purchase`, `GET /me/tickets` (`data-ticket-code`/`data-ticket-status`) | testes, fluxo |
| F06 | `GET /api/partner/events`, `POST /api/partner/events/:id/purchases`, `GET /api/partner/tickets/:id` | testes (`app.inject` com `X-Api-Key`), fluxo |
| F07 | `checkIn`, `CHECKIN_MESSAGES`, `getPanel`; rota `POST /org/events/:id/checkin` (`data-checkin-result`); painel (`data-metric`) | testes, fluxo |

## 5. Modelo de dados

Sem migração.

| Tabela | Antes | Depois do cancelamento |
|---|---|---|
| `events` | `status='published'` | `status='cancelled'`, `cancelled_at=now()`, `updated_at=now()` |
| `tickets` | `confirmed` | `refunded` (`checked_in_at` preservado) |
| `tickets` | `pending` | `cancelled` |
| `tickets` | `declined` / `cancelled` / `refunded` | inalterado |
| `payments` | qualquer | inalterado por F08; o dispatcher conclui (`done`) sem mudar o ticket |

Depois do cancelamento, `getSeatCounts` devolve `available = 0` (F04, R05). O painel fica com Confirmados 0, Pendentes 0, Check-ins 0, Vagas 0, Receita `R$ 0,00` e Estornados = nº de ex-confirmados.

## 6. Regras citadas

- **R11:** cancelamento irreversível de evento publicado; sai da vitrine e da API; não vende; não pode ser editado nem republicado; confirmados → estornados e pendentes → cancelados em ≤ 10 s; resposta tardia do gateway não muda nada.
- **R02:** evento cancelado não aparece na vitrine nem na listagem da API e não aceita compras.
- **R05:** vagas disponíveis = 0 em evento cancelado.
- **R08:** o gateway segue respondendo; o resultado só vale para ticket `pending` em evento não cancelado (F03).
- **R09:** "Meus ingressos" mostra `estornado` / `cancelado`.
- **R10:** em evento cancelado, o check-in de um código desse evento mostra `Evento cancelado`; código inexistente/de outro evento continua `Ingresso inválido para este evento`.
- **R12:** o painel não conta estorno como receita.
- **R13:** só o dono cancela; os demais recebem 404 (outro organizador), 403 (participante) ou redirect para `/login` (visitante).

## 7. Mensagens e rótulos literais

- Botão: `Cancelar evento`.
- Aviso em evento cancelado: `Evento cancelado` (mesmo texto de R10).
- Rótulos de status (F01 `statusLabel`, brief): `estornado` (`refunded`), `cancelado` (`cancelled`), `confirmado`, `pendente`, `recusado`.
- Mensagem de rejeição (texto livre de F08): `Só é possível cancelar um evento publicado.`
- Mensagens verificadas pelo fluxo (literais do brief): `Ingressos esgotados`, `Entrada liberada`, `Ingresso já utilizado`, `Ingresso não confirmado`, `Ingresso inválido para este evento`, `Evento cancelado`; JSON `{"error":"unauthorized"}`, `{"error":"invalid_request"}`, `{"error":"event_not_available"}`, `{"error":"sold_out"}`, `{"error":"ticket_not_found"}`; receitas `R$ 350,00` e `R$ 0,00`.

## 8. Fluxo do avaliador (`scripts/flow/evaluator-flow.mjs`): roteiro e asserts

Atores:
- `A` (`org.a@catraca.dev`), `B` (`org.b@catraca.dev`) e `S` (`participante@catraca.dev`), todos com a senha `catraca123`;
- `P`, um participante novo criado no passo 5;
- `V`, o visitante, sem cookie;
- o parceiro, que usa o header `X-Api-Key: $KEY`.

Datas: `startsAt` = hoje + 30 dias às 21:00 em `America/Sao_Paulo` (`YYYY-MM-DDTHH:MM`), e "ontem" = hoje − 1 dia às 21:00. Nomes: `E1 Fluxo <runId>` etc. Local: `Porão do Fluxo`. O id de um evento criado vem do `Location` de `POST /org/events/new`; como fallback, do link `/org/events/evt_…` do nome em `GET /org/events`.

| Passo | Ações | Asserts (qualquer falha → `FAIL passo N`, exit 1) |
|---|---|---|
| 2 | A faz login e cria E1 (lotação 2, `100,00`, +30 dias) sem publicar. | O login cria o cookie de sessão. E1 tem um id `evt_…`. Em `GET /` de V, o nome e o id de E1 não aparecem. `GET /api/partner/events` responde 200 com um array sem o id de E1. |
| 3 | A cria `Ontem Fluxo <runId>` com a data de ontem. | Status ≠ 5xx. `GET /org/events` de A não contém esse nome. |
| 4 | A publica E1. | `GET /` de V contém o nome e `/events/<E1>`. Na listagem da API, o item `id === E1` tem exatamente as chaves `id,name,startsAt,priceCents,availableSeats`, com `availableSeats 2` e `priceCents 10000`. |
| 5 | P se cadastra (`/signup`) e compra E1 com `4000000000000001` (marca `t5`). | A compra responde `303` → `/me/tickets`. O primeiro `GET /me/tickets` tem 1 linha `data-ticket-status="pending"` e o texto `pendente`. Recarregando, a linha fica `confirmed` (texto `confirmado`) em ≤ 5 s desde `t5`. O código C1 casa `^[A-Z2-9]{8}$` e a página contém o nome de E1. |
| 6 | API: compra de E1 com `4000000000000004` (marca `t6`). | Responde `202` com exatamente `ticketId,code,status`, `status:"pending"` (T2, C2). A listagem mostra E1 com `availableSeats 0`. |
| 7 | API: compra de E1 com `4000000000000001`. P abre `/events/<E1>`. | A compra responde `409` com `{"error":"sold_out"}`. A página contém `Ingressos esgotados`. Tudo acontece antes de 30 s desde `t6`. |
| 8 | Espera até `t6 + 45 s`. API: compra de E1 com `0001` (T3, marca `t8`). | Antes da compra, `GET /tickets/T2` → `status:"declined"` e a listagem mostra E1 com `availableSeats 1`. A compra responde `202`. T3 fica `confirmed` em ≤ 5 s desde `t8`. |
| 9 | A edita E1 com lotação 1 (demais campos iguais). Depois edita com preço `150,00` e lotação 3. API: compra com `0001` (T4). | Depois da primeira edição: `<input name="capacity">` com valor `2`, e a API mostra `priceCents 10000` e `availableSeats 0`. Depois da segunda: capacidade `3`, `priceCents 15000` e `availableSeats 1`. T4 fica `confirmed` em ≤ 5 s. O painel de E1 (`data-metric`) mostra `confirmed=3`, `pending=0`, `checkins=0`, `available=0`, `revenue=R$ 350,00` e `refunded=0`. |
| 10 | A faz check-in em E1: C1, C1, C2, `ZZZZZZZZ`. Guarda `manageUrl = $WEB/org/events/<E1>`. | Os resultados (`data-checkin-result`), nesta ordem: `Entrada liberada`, `Ingresso já utilizado`, `Ingresso não confirmado`, `Ingresso inválido para este evento`. O painel mostra `checkins=1`. |
| 11 | B faz login: lista de eventos e `manageUrl`. B cria e publica E2 (lotação 1, `20,00`). O id de E2 sai **da listagem da API**, pelo nome. API: compra de E2 com `0001` (C3). S abre `manageUrl`; V abre `manageUrl`. A faz check-in de C3 em E1. | A lista de B não contém nem o nome nem o id de E1. `manageUrl` responde `404` para B, `403` para S e `302 → /login…` para V. Nenhum desses corpos contém o nome de E1, o local, C1, C2, `data-metric` ou `data-checkin-result`. A compra de E2 responde `202`. O check-in de C3 em E1 → `Ingresso inválido para este evento`. |
| 12 | A cria e publica E3 (lotação 5, `50,00`) e abre a página de gestão. API: compra com `4000000000000003` (T5, marca `t12`) e, logo depois, com `4000000000000001` (T6, C6). Quando T6 fica `confirmed`, A cancela E3. | A página de gestão de E3 contém `Cancelar evento`. T6 fica `confirmed` em ≤ 5 s. O cancelamento acontece antes de `t12 + 30 s` e responde `303` → `/org/events/<E3>` (marca `tc`). |
| 13 | V abre `/`. API: listagem e compra de E3. A abre a gestão de E3 e tenta editá-lo (nome `Editado <runId>`). | `/` não contém o nome nem o id de E3, e a listagem não contém E3. A compra responde `404` com `{"error":"event_not_available"}`. Em ≤ 10 s desde `tc`, `GET /tickets/T6` → `refunded` e `GET /tickets/T5` → `cancelled`. A página de gestão de E3 não tem `<input name="capacity">`, não tem form com action `…/<E3>/publish` e não tem `Cancelar evento`. Depois da tentativa de edição, a página não contém `Editado <runId>` e mantém o nome original. |
| 14 | Espera até `t12 + 45 s`. A faz check-in de C6 em E3. | T5 continua `cancelled` e T6 continua `refunded`. O check-in mostra `Evento cancelado` em `data-checkin-result`; se o campo não existir, a página mostra `Evento cancelado` e nenhum `Entrada liberada`. O painel de E3 mostra `confirmed=0`, `pending=0`, `checkins=0`, `available=0`, `revenue=R$ 0,00` e `refunded=1`. |
| 15 | Para E4 e depois E5: A cria e publica (lotação 5, `10,00`). São disparados 30 `POST …/purchases` simultâneos (`carga<i>-<runId>@example.com`, `0001`), com a marca `tb`. | A contagem é exatamente `202 × 5` e `409 × 25`, e todo 409 tem `{"error":"sold_out"}`. Em ≤ 10 s desde `tb`, o painel mostra `confirmed=5` e `available=0`. |
| 16 | Nas 3 rotas (`GET /events`, `POST /events/<E4>/purchases` com corpo válido e `GET /tickets/<T3>`): sem header e com `X-Api-Key: chave-errada`. Compra com `"cardNumber":"123"` (chave válida). `GET /tickets/tkt_naoexiste0`. | As 6 respostas são `401` com corpo deep-equal a `{"error":"unauthorized"}`. A compra com cartão inválido responde `422` `{"error":"invalid_request"}`. O ticket inexistente responde `404` `{"error":"ticket_not_found"}`. |

Em escala 1 o fluxo leva no mínimo ~90 s (duas esperas de 45 s), o que evidencia que os tempos são reais.

## 9. Arquivos

**Cria:**
- `src/cancel/service.ts`, `src/cancel/routes.ts`.
- `scripts/flow/evaluator-flow.mjs`, `scripts/flow/evaluator-flow.d.mts`.
- `test/f08/support.ts`: `startTestDispatcher`, `waitFor`, `apiInject(app, method, url, body?, key?)`.
- `test/f08/cancel.service.test.ts`, `test/f08/cancel.race.test.ts`, `test/f08/cancel.routes.test.ts`, `test/f08/cancel.cross.test.ts`, `test/f08/flow.integration.test.ts`.

**Altera:**
- `src/views/cancel/_cancel.ejs` (vazio, de F04).
- `src/features.ts`: +1 linha `cancelPlugin`.
- `package.json`: script `"flow": "node scripts/flow/evaluator-flow.mjs"`, **só se** F01 ainda não o tiver criado.
- `state/project-state.json`: **só** a entrada `F08`.

**Pode alterar, só se indispensável e com registro no PR:** a configuração de lint/typecheck de F01 (`eslint.config.*`/`tsconfig*.json`), para incluir `scripts/flow/*.mjs`/`.d.mts`, e o `.dockerignore`, se ele excluir `scripts/` do stage `dev` usado pelos gates.

**Não toca:** `src/events/**`, `src/purchases/**`, `src/partner/**`, `src/checkin/**`, `src/gateway/**`, `src/views/org/**`, `src/views/checkin/**`, `test/helpers.ts`, `migrations/**`. Se a verificação de F08 revelar defeito numa feature consumida (ex.: um guard de F04), a correção é registrada no PR de F08 com o motivo e se limita ao mínimo necessário (AGENTS.md, regra 9).

## 10. Estratégia de testes

vitest contra Postgres real, `resetDb()` em `beforeEach`, `buildApp({ startDispatcher: false })` e `app.inject()`. Quando o caminho real do gateway importa, os testes usam um dispatcher local `createDispatcher({ gateway: new SimulatedGateway({ scale }), pollMs })`. **Os nomes de teste começam pelo ID do item de contrato** (`C-F08-nn …`), sem caracteres especiais de regex.

| Arquivo | Cobre |
|---|---|
| `cancel.service.test.ts` | transições de `cancelEvent` (confirmed → refunded, pending → cancelled, declined intacto, `checked_in_at` preservado, `cancelled_at` gravado, efeito imediato); `not_found` (inexistente, outro dono); `not_cancellable` (draft, já cancelado) sem efeito |
| `cancel.race.test.ts` | AC-F08-02: 20 rodadas × (cancelamento ∥ 20 `applyGatewayResult`). Nunca sobra `confirmed`/`pending`, sem deadlock, `cancelled + refunded + declined = 20` |
| `cancel.routes.test.ts` | `POST /org/events/:id/cancel` (303; 409 para draft/cancelado; 404 para outro org; 403 para participante; 302 para visitante); `_cancel.ejs` em cada status |
| `cancel.cross.test.ts` | XC-F08-F03-01 (cartão `0003` com dispatcher local em escala 0,01); XC-F08-F04-01 (vitrine, `/events/:id`, gestão sem edição/publicação, POSTs rejeitados, `getSeatCounts`/`listOnSaleEvents`); XC-F08-F05-01 (`purchaseTicket` → `event_not_available`; `/me/tickets` com `estornado`/`cancelado`); XC-F08-F06-01 (API); XC-F08-F06-02 (`checkedIn` false → true); XC-F08-F07-01 (check-in `Evento cancelado` e painel zerado) |
| `flow.integration.test.ts` | `runFlow` contra a app em `app.listen({ port: 0, host: '127.0.0.1' })`, com dispatcher local em escala 0,1 (`pollMs: 50`) e `scale: 0.1`. Espera `ok: true` com os 15 passos (2–16). Timeout 180 s |

Verificações em tempo real (escala 1) rodam contra o produto no ar: `npm run flow` e os itens `curl` do contrato.

## 11. Questões em aberto

1. **Script `flow` no `package.json`.** O architecture.md diz que `npm run flow` é "entregue por F08", e o AGENTS.md já o lista. Se F01 já criou a entrada apontando para o arquivo ainda inexistente, F08 não mexe no `package.json`; senão, acrescenta a linha.
2. **Import de `.mjs` em TypeScript e nos gates.** O teste `flow.integration.test.ts` importa `../../scripts/flow/evaluator-flow.mjs`. Isso exige que o stage `dev` do Dockerfile (gates) copie `scripts/`, que o `tsc --noEmit` aceite o import (por isso o `.d.mts`) e que o ESLint de F01 não reprove `.mjs` (globals de Node). Se a configuração de F01 não cobrir isso, F08 faz o ajuste mínimo e o registra no PR (§9).
3. **Status HTTP de rejeição em F04.** O architecture.md não fixa o status da edição rejeitada (lotação < ocupadas, data passada) nem o de edição/publicação de evento cancelado. O fluxo e os testes de F08 verificam pelo **efeito** (D11) e só exigem "não 5xx". Se o avaliador exigir um status específico, isso precisa ser fixado no architecture.md/F04.
4. **Redirect da criação de evento (F04).** O fluxo obtém o id de E1/E3/E4/E5 do `Location` de `POST /org/events/new`, supondo `/org/events/evt_…`. Há um fallback pela lista `/org/events`. E2 segue o brief: o id sai da listagem da API.
5. **Marcação HTML usada pelo fluxo.** O fluxo depende de convenções do architecture.md e das specs consumidas: `data-ticket-code` e `data-ticket-status` na **mesma** tag da linha (F05), `data-metric` contendo só o valor (F07), `data-checkin-result` (F07), `<input name="capacity" value="…">` no formulário de edição (F04) e o link `/events/<id>` na vitrine (F04). Se alguma delas divergir na `main`, o fluxo falha. F08 ajusta o **fluxo** (não o produto), a menos que a divergência viole o architecture.md.
6. **XC-F08-F06-02 fora do roteiro do brief.** O Fluxo do avaliador não consulta `checkedIn` depois do check-in. Para manter `npm run flow` fiel aos passos 2–16, o critério é verificado em teste (C-F08-16) e num item `curl` ao vivo próprio (C-F08-18), não no fluxo.
7. **Participante da seed em `manageUrl` (passo 11).** O fluxo exige `403` (participante) e `302 → /login` (visitante), conforme `requireOrganizer` no architecture.md §5 (F02). O brief só exige "não exibe dados de E1", então os asserts do corpo valem independentemente do status.
