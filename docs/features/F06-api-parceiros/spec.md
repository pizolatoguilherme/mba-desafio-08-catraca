# Spec — F06 API de parceiros

> Wave **W4**, em **paralelo** com F07 (check-in & painel). Branch `feat/F06-api-parceiros`, worktree própria. Consome F04 e F05 (`done` na `main` antes do início).
> **F06 não depende de F07** e não importa nada de `src/checkin/`. O campo `checkedIn` vem direto de `tickets.checked_in_at` (schema de F01). A integração F06 × F07 é verificada na integradora F08 (`XC-F08-F06-02`).
> Fontes: [`docs/brief.md`](../../brief.md) ("API de parceiros (contrato fixo)", R02, R05–R09, passos 2, 4, 6–8, 15 e 16 do Fluxo do avaliador), [`docs/PRD.md`](../../PRD.md) (§5 F06, §6, §8), [`docs/architecture.md`](../../architecture.md) (§5 F06, §6, §7).

## 1. Objetivo

Expor a venda de ingressos a sistemas externos pelas três rotas do **contrato fixo** do brief, autenticadas por `X-Api-Key`, com exatamente os campos, os status HTTP e os códigos de erro do contrato. As compras pela API passam por `purchaseTicket` (F05) e, portanto, disputam as mesmas vagas, sob o mesmo lock, que as da vitrine. A API precisa ser robusta aos defaults do Fastify: nenhuma entrada de cliente produz 400, 415 ou 500.

## 2. Escopo e fora de escopo

### Escopo
- `src/partner/plugin.ts`: plugin encapsulado com prefixo `/api/partner`, contendo a autenticação, o parser de corpo próprio, o error handler, o not-found handler e as três rotas.
- `GET /api/partner/events`, `POST /api/partner/events/:eventId/purchases` e `GET /api/partner/tickets/:ticketId`.
- Testes `test/f06/*` (autenticação, listagem, compra, robustez, consulta, integração com F04/F05, rajada HTTP e gateway).

### Fora de escopo
- Check-in e painel (F07). F06 só **lê** `checked_in_at`; quem o escreve é F07. O caminho real "check-in → `checkedIn: true`" é verificado em F08.
- Cancelamento (F08). Evento cancelado é exercitado por fixture (`createEvent({ status: 'cancelled' })`).
- Paginação, busca, filtros e ordenação configurável da listagem (PRD §10).
- Rate limiting, várias chaves por parceiro, rotação de chave, idempotency key.
- Vincular compra de parceiro a conta de participante (o brief diz que não ficam vinculadas).
- Qualquer mudança em `purchaseTicket` ou no schema.

## 3. Regras citadas

| Regra / trecho do brief | Como F06 a atende |
|---|---|
| Autenticação | toda rota exige `X-Api-Key` igual a `config.partnerApiKey`; sem cabeçalho ou com chave inválida → `401 {"error":"unauthorized"}`, **antes** de qualquer parsing |
| IDs são strings | `id`, `ticketId` e `eventId` saem como strings JSON (`evt_…`, `tkt_…`) |
| R02 | a listagem só traz `published` (que exclui `draft` e `cancelled`), via `listOnSaleEvents`; compra em `draft`/`cancelled`/inexistente → `404 event_not_available` |
| R05 | `availableSeats` = vagas disponíveis de `getSeatCounts` (lotação − `pending` − `confirmed`) |
| R06 | compra → `202 {"ticketId","code","status":"pending"}` sem esperar o gateway; não vinculada a conta (`channel='partner'`, `user_id = null`) |
| R07 | sem vaga → `409 {"error":"sold_out"}`; a concorrência é garantida pelo lock de `purchaseTicket` (F05 spec §8.1) |
| R08 | `GET /tickets/:id` reflete `confirmed`/`declined` aplicados pelo dispatcher (F03) |
| R09 | a consulta devolve `code`; `checkedIn` é informação à parte do status |
| Ordem de erros da compra | chave (401) → corpo (422) → evento (404) → vaga (409) |

## 4. Interfaces consumidas

| De | Interface | Uso |
|---|---|---|
| F01 | `config.partnerApiKey` (`src/config.ts`) | chave esperada (default `catraca-parceiro-2026`) |
| F01 | `toIsoWithOffset(d)` (`src/format.ts`) | `startsAt` com offset (`2026-12-05T21:00:00-03:00`) |
| F01 | `featurePlugins` (`src/features.ts`) | registro de `partnerPlugin` (1 linha) |
| F01 | `resetDb`, `createUser`, `createEvent`, `insertTicket({ checkedIn })` (`test/helpers.ts`) | fixtures |
| F04 | `listOnSaleEvents(db?)` (`src/events/repo.ts`) | listagem (`published`, ordenada por `starts_at`, com `available` de `getSeatCounts`) |
| F05 | `purchaseTicket(i)`, `validatePurchaseInput(i)`, `findTicketById(id)`, `TicketRow` (`src/purchases/service.ts`) | compra, validação do corpo e consulta |
| F02 (só testes) | `loginAs` (`test/helpers.ts`) | testes cross-feature pela UI (criar/publicar evento, comprar na vitrine) |
| F03 (só testes) | `dispatcher` (spy em `kick`), `createDispatcher`, `SimulatedGateway` | dispatcher parado ou em escala 0,01 nos testes |

F06 **não** importa `isValidCardNumber` (F03) diretamente: a validação do cartão vem encapsulada em `validatePurchaseInput` (PRD §3). Nenhum import de `src/checkin/` (F07) nem de `src/cancel/` (F08).

## 5. Interfaces providas

```ts
// src/partner/plugin.ts
export const partnerPlugin: FastifyPluginAsync;   // encapsulado (SEM fastify-plugin); registrado em src/features.ts
```

`partnerPlugin` faz `app.register(partnerRoutes, { prefix: '/api/partner' })`. Como não usa `fastify-plugin`, o parser, os hooks e os handlers de erro e de 404 valem **só** dentro de `/api/partner/*` e não afetam as páginas HTML.

Rotas HTTP (contrato fixo, brief e PRD §8):

| Rota | Sucesso | Erros, na ordem |
|---|---|---|
| `GET /api/partner/events` | `200` `[{ "id", "name", "startsAt", "priceCents", "availableSeats" }]` | `401 unauthorized` |
| `POST /api/partner/events/:eventId/purchases` | `202` `{ "ticketId", "code", "status": "pending" }` | `401 unauthorized` → `422 invalid_request` → `404 event_not_available` → `409 sold_out` |
| `GET /api/partner/tickets/:ticketId` | `200` `{ "ticketId", "code", "eventId", "status", "checkedIn" }` | `401 unauthorized` → `404 ticket_not_found` |

Mapeamento de campos (objetos montados **campo a campo**, nesta ordem de chaves; nunca se faz spread de linhas do banco):

| JSON | Origem | Tipo |
|---|---|---|
| `id` | `events.id` | string `evt_…` |
| `name` | `events.name` | string |
| `startsAt` | `toIsoWithOffset(events.starts_at)` | string ISO 8601 com offset `-03:00` |
| `priceCents` | `events.price_cents` | inteiro |
| `availableSeats` | `available` de `listOnSaleEvents` (R05) | inteiro ≥ 0 |
| `ticketId` | `tickets.id` | string `tkt_…` |
| `code` | `tickets.code` | string de 8 caracteres `[A-Z2-9]` |
| `status` (compra) | literal `"pending"` (de `purchaseTicket`) | string |
| `eventId` | `tickets.event_id` | string `evt_…` |
| `status` (consulta) | `tickets.status`, sem tradução | `pending`·`confirmed`·`declined`·`cancelled`·`refunded` |
| `checkedIn` | `tickets.checked_in_at !== null` | boolean |

Todas as respostas, inclusive os erros, têm `Content-Type: application/json; charset=utf-8`.

## 6. Modelo de dados

Sem tabela, coluna ou migração nova. Leitura de `events` (via `listOnSaleEvents`) e de `tickets` (via `findTicketById`). A escrita (`tickets` + `payments`) acontece só dentro de `purchaseTicket` (F05). A compra de parceiro grava `channel='partner'`, `user_id = NULL` e `buyer_email` = `buyerEmail` do corpo.

## 7. Decisões técnicas

### 7.1 Autenticação em `onRequest`, com comparação timing-safe
- O hook `onRequest` do escopo roda **antes** do parsing do corpo. Por isso uma requisição sem chave, mesmo com JSON malformado ou `Content-Type` estranho, recebe `401` e nunca `422`/`415` (AC-F06-08).
- Comparação: `timingSafeEqual(sha256(recebida), sha256(config.partnerApiKey))`. Comparar os digests resolve a exigência de mesmo tamanho do `timingSafeEqual` e não vaza o tamanho da chave pelo tempo.
- Cabeçalho ausente, vazio, repetido (o Node o entrega como array) ou diferente → `reply.code(401).send({ error: 'unauthorized' })`. Os nomes de cabeçalho HTTP não diferenciam maiúsculas (`x-api-key` vale).
- A chave e o número do cartão nunca são logados.

### 7.2 Parser de corpo próprio e validação no handler
- No escopo: `removeAllContentTypeParsers()` e `addContentTypeParser('*', { parseAs: 'string', bodyLimit: 16384 }, (req, body, done) => done(null, body))`. **Qualquer** `Content-Type` (ou nenhum) é aceito como texto, então o Fastify nunca responde 415 nem 400 de JSON.
- O handler da compra (`parsePurchaseBody`) devolve `invalid_request` se:
  1. o *media type* (antes do `;`, sem espaços, minúsculo) **não** é `application/json` (ausente, `text/plain`, `application/x-www-form-urlencoded`…). O brief define a compra "com `Content-Type: application/json`", e o AC-F06-08 pede 422 para `Content-Type` ausente ou errado. `application/json; charset=utf-8` é aceito;
  2. o corpo é vazio ou não é string;
  3. `JSON.parse` lança;
  4. o resultado não é objeto simples (`null`, array, número, string);
  5. `validatePurchaseInput({ buyerEmail, cardNumber })` falha (campo ausente, não string, e-mail mal formado, cartão sem 16 dígitos).
- Campos extras no objeto são ignorados (o brief só lista os inválidos).

### 7.3 Error handler e not-found handler do escopo
- `setErrorHandler` do escopo: erro com `statusCode` entre 400 e 499 (ex.: `FST_ERR_CTP_BODY_TOO_LARGE` 413 acima de 16 KiB, qualquer `FST_ERR_CTP_*` residual, erro de validação) → `422 {"error":"invalid_request"}`. Qualquer outro erro → log + `500 {"error":"internal_error"}`, sempre JSON e nunca a página HTML de erro.
- `setNotFoundHandler` do escopo, para rota ou método desconhecido sob `/api/partner/*`: refaz a checagem da chave (não depende de o Fastify rodar o `onRequest` no 404) → `401 {"error":"unauthorized"}` sem chave válida. Com chave válida, responde **pela forma do caminho**:
  - `GET`/`HEAD /api/partner/tickets/<qualquer segmento>` → `404 {"error":"ticket_not_found"}`;
  - `POST /api/partner/events/<qualquer segmento>/purchases` → `404 {"error":"event_not_available"}`;
  - qualquer outro → `404 {"error":"not_found"}`.

  Isso é necessário porque o roteador do Fastify (find-my-way) **não casa** a rota quando um parâmetro passa de `maxParamLength` (default 100 caracteres). Sem esse mapeamento, um id de 300 caracteres responderia `not_found` em vez do erro da rota (AC-F06-08).

### 7.4 IDs em formato inesperado
Antes de tocar no banco, `eventId` precisa casar com `^evt_[a-z0-9]{10}$` e `ticketId` com `^tkt_[a-z0-9]{10}$` (formato de `newId`, architecture.md §5). Fora disso, a resposta é `404 event_not_available` / `404 ticket_not_found`. Isso evita levar ao Postgres strings com `\u0000` (que dão erro de encoding, ou seja, 500), strings enormes ou sequências estranhas, e mantém o 404 do contrato. Na compra, a checagem de formato vem **depois** da validação do corpo, para preservar a ordem `422 → 404`.

### 7.5 Compra
```
POST /api/partner/events/:eventId/purchases
  (onRequest) chave → 401
  b = parsePurchaseBody(req)              → inválido: 422 invalid_request
  formato de eventId                      → inválido: 404 event_not_available
  r = await purchaseTicket({ eventId, channel: 'partner', userId: null, buyerEmail: b.buyerEmail, cardNumber: b.cardNumber })
  r.ok                                    → 202 { ticketId: r.ticket.id, code: r.ticket.code, status: 'pending' }
  r.error === 'invalid_request'           → 422   (não acontece depois do passo 2, mas é mapeado)
  r.error === 'event_not_available'       → 404
  r.error === 'sold_out'                  → 409
```
R07 sob concorrência é responsabilidade de `purchaseTicket` (lock `FOR UPDATE` na linha do evento em READ COMMITTED, F05 spec §8.1). F06 não acrescenta lock nem contagem própria: qualquer checagem de vaga fora do lock reintroduziria o *check-then-insert*. Com 30 requisições simultâneas, cada uma segura uma conexão do pool (`max: 50`) enquanto espera o lock. Não há fila nem limite na API.

### 7.6 Listagem e consulta
- `GET /events`: `listOnSaleEvents()` → `map` campo a campo (§5). A ordem é a de `listOnSaleEvents` (`starts_at`). Sem paginação.
- `GET /tickets/:ticketId`: formato do id → `findTicketById` → `null` ⇒ `404 ticket_not_found`, senão `200` (§5). A consulta devolve ingressos de **qualquer** canal (inclusive vitrine, XC-F06-F05-02), como diz o brief: as compras pela API "valem … exatamente como as da vitrine", e a consulta é por id de ingresso.

### 7.7 Independência de F07 na wave paralela
Os dois PRs da W4 só tocam arquivos em comum em `src/features.ts` (uma linha cada) e `state/project-state.json` (uma entrada cada), e ambos os conflitos são triviais. `checkedIn` é testado com a fixture `insertTicket({ checkedIn: true })` de F01. F06 não lê nem escreve nada que F07 crie.

## 8. Casos de erro e mensagens

| Situação | Status | Corpo |
|---|---|---|
| Sem `X-Api-Key`, chave vazia, errada ou repetida (qualquer rota, inclusive desconhecida, e mesmo com corpo malformado) | 401 | `{"error":"unauthorized"}` |
| `Content-Type` ausente ou diferente de `application/json` | 422 | `{"error":"invalid_request"}` |
| Corpo vazio, JSON malformado, `null`, array ou não-objeto | 422 | `{"error":"invalid_request"}` |
| `buyerEmail`/`cardNumber` ausente ou não string; e-mail mal formado; cartão ≠ 16 dígitos (ex.: `"123"`) | 422 | `{"error":"invalid_request"}` |
| Corpo > 16 KiB | 422 | `{"error":"invalid_request"}` |
| `eventId` fora do formato, inexistente, `draft` ou `cancelled` (com corpo válido) | 404 | `{"error":"event_not_available"}` |
| Sem vaga | 409 | `{"error":"sold_out"}` |
| `ticketId` fora do formato (inclusive > 100 caracteres, via not-found handler) ou inexistente | 404 | `{"error":"ticket_not_found"}` |
| Rota/método desconhecido sob `/api/partner` com chave válida | 404 | `{"error":"not_found"}` |
| Erro inesperado do servidor | 500 | `{"error":"internal_error"}` |

## 9. Arquivos

| Arquivo | Ação |
|---|---|
| `src/partner/plugin.ts` | **cria** (`partnerPlugin`, `partnerRoutes`, `checkApiKey`, `parsePurchaseBody` e os serializadores) |
| `src/features.ts` | **altera** (1 linha: `partnerPlugin`) |
| `test/f06/auth.test.ts`, `events.test.ts`, `purchases.test.ts`, `robustness.test.ts`, `tickets.test.ts`, `integration.test.ts`, `burst.test.ts`, `gateway.test.ts` | **cria** |
| `state/project-state.json` | **altera** (só a entrada `F06`) |

Nenhum arquivo de F01–F05 muda além de `src/features.ts`. `scripts/burst.sh` é de F01 e só é **executado** no contrato.

## 10. Estratégia de testes

Vitest de integração contra o Postgres efêmero dos gates, com `resetDb()` no `beforeEach` e `buildApp({ startDispatcher: false })` + `app.inject()`. `dispatcher.kick` vira spy no-op (como em F05) para os ingressos ficarem `pending`, exceto em `gateway.test.ts`. Todas as asserções de corpo comparam `Object.keys(body)` com a lista **exata** do contrato e checam `typeof` de cada campo.

- **`auth.test.ts`**: as 3 rotas × (sem cabeçalho, chave errada, chave vazia, chave com um caractere a mais) → 401 com corpo exato; POST sem chave com JSON malformado e `Content-Type: text/plain` → 401; chave correta em `x-api-key` minúsculo → passa; rota desconhecida → 401 sem chave e 404 `not_found` com chave.
- **`events.test.ts`**: fixtures `draft`, `published` e `cancelled` → só o `published` aparece; chaves exatas; `startsAt` casa com `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$` e representa o mesmo instante de `starts_at`; `availableSeats` com tickets `pending`+`confirmed`+`declined`+`cancelled` em lotação 5 → `5 − (pending + confirmed)`.
- **`purchases.test.ts`**: 202 com chaves exatas, `status: 'pending'`, ingresso no banco com `channel='partner'` e `user_id IS NULL`; matriz da ordem de erros (corpo inválido + evento inexistente → 422; corpo inválido + evento lotado → 422; corpo válido + `draft`/`cancelled`/inexistente → 404; corpo válido + lotado → 409); nenhum ingresso criado nos erros.
- **`robustness.test.ts`**: tabela de corpos inválidos (malformado, vazio, `null`, `[]`, `"texto"`, `42`, campos numéricos, campos ausentes, `Content-Type` ausente/`text/plain`/form, corpo de 20 KiB) → 422 com corpo exato e **nunca** 400/415/500; ids `evt_%00`, `' OR 1=1--`, 300 caracteres, `EVT_…` maiúsculo → 404 da rota.
- **`tickets.test.ts`**: chaves e tipos exatos; `checkedIn: true` com `insertTicket({ status: 'confirmed', checkedIn: true })` e `false` sem; os 5 status saem com o valor da API; inexistente → 404 `ticket_not_found`.
- **`integration.test.ts`** (pela UI, com `loginAs`): XC-F06-F04-01 (rascunho criado por `POST /org/events/new` não aparece; depois de `POST /org/events/:id/publish`, aparece com `priceCents` = preço × 100, `startsAt` = data/hora do formulário com `-03:00` e `availableSeats` = lotação); XC-F06-F05-01 (lotação 2: 1 compra pela vitrine + 1 pela API → a próxima pela API responde 409 e `GET /events/:id` mostra `Ingressos esgotados`); XC-F06-F05-02 (o ingresso comprado na vitrine é consultado pela API com o mesmo `code` e `status` de "Meus ingressos").
- **`burst.test.ts`**: 10 rodadas, cada uma com evento novo de lotação 5 e 30 `app.inject` POST simultâneos (`Promise.all`) → exatamente 5 × 202 e 25 × 409 (corpo `{"error":"sold_out"}`), e 5 ingressos no banco.
- **`gateway.test.ts`**: dispatcher de teste em escala 0,01 → `0001` vira `confirmed` na consulta; `0004` fica `pending` (com `availableSeats` reduzido) e depois `declined`, com `availableSeats` de volta.

Os itens de tempo real (`0001` ≤ 5 s; `0004` 30–40 s; rajada do passo 15) são verificados no contrato contra o produto no ar em escala 1.

## 11. Questões em aberto

1. **`Content-Type` errado com JSON válido**: o architecture.md diz que o parser "aceita qualquer `Content-Type` (ou nenhum) como texto"; o AC-F06-08 pede `422` para `Content-Type` ausente/errado. Esta spec concilia os dois: o parser aceita tudo (para nunca dar 415) e o handler exige o media type `application/json`. Consequência: um parceiro que mande JSON válido como `text/plain` recebe 422. É o que o PRD pede, mas é mais estrito que o necessário para o Fluxo do avaliador, que sempre manda `application/json`.
2. **Percent-encoding malformado na URL** (ex.: `/api/partner/tickets/%zz`): o Fastify rejeita no roteador (`FST_ERR_BAD_URL`, 400) **antes** do escopo do plugin. Para responder 404 aí, seria preciso o `frameworkErrors` no `buildApp` de F01 (`src/server.ts`), fora dos arquivos de F06. O contrato só usa encodings válidos (`%00`, `%27`, `%20`, ids longos). Sugestão: F01/F08 avaliarem `frameworkErrors` para `/api/partner/*`.
3. **Erros fora do contrato fixo**: `404 {"error":"not_found"}` (rota desconhecida com chave) e `500 {"error":"internal_error"}` não estão no brief. Foram escolhidos para manter JSON em todo o prefixo. Nenhum caminho do Fluxo do avaliador os alcança.
4. **Formato estrito dos ids** (`^evt_[a-z0-9]{10}$` / `^tkt_[a-z0-9]{10}$`): acopla F06 ao `newId` de F01. Se F01 mudar o formato, o regex precisa mudar junto. Fixtures de teste que criem ids fora de `newId` dariam 404.
5. **Painel no passo 15**: o "Confirmados 5 e Vagas disponíveis 0 em até 10 s" do passo 15 é do painel de F07 (XC-F07-F05-03) e não pode ser verificado em F06, por causa da wave paralela. O contrato de F06 verifica o equivalente pela própria API: `availableSeats: 0` e os 5 `ticketId` com 202 em `confirmed` em até 10 s.
6. **`scripts/burst.sh`** é entregue por F01. Pela spec de F01, ele cria cada evento direto no banco (`docker compose exec -T db psql`), dispara o comando do passo 15 e imprime `Rodada <n> (<evt_id>): <n202> x 202, <n409> x 409 — OK|FALHOU`, com saída 0 só se todas as rodadas derem 5 × 202 e 25 × 409. O contrato de F06 (C-F06-24) usa esse formato. Os eventos do burst.sh não passam pela UI. Por isso o C-F06-22 repete o comando literal com eventos criados pela UI.
7. **Contrato depende de F04/F01 em pontos que não estão no architecture.md, mas estão nas specs delas**: `POST /org/events/new` responde `303` com `Location: /org/events/<id>` (F04 D3), usado para pegar o id, e `npm run gates -- <args>` roda um teste nomeado (F01 D6). Mesma observação da spec de F05 §13.7.
8. **`eventId` maior que `maxParamLength` (100)**: a rota de compra não casa, e o not-found handler responde `404 event_not_available` sem olhar o corpo. Só nesse caso extremo, a ordem "corpo inválido → 422 antes de 404" não é preservada (um id assim nunca existe). Para preservá-la, F01 precisaria aumentar `routerOptions.maxParamLength` no `buildApp`, fora dos arquivos de F06. Os testes de ordem (C-F06-05, C-F06-17) usam ids de tamanho normal.
9. **`checkedIn` real** (check-in por F07 → `true` na API) fica fora deste contrato por construção da wave. É coberto por `XC-F08-F06-02` em F08 e pelo passo 10 do Fluxo do avaliador.
