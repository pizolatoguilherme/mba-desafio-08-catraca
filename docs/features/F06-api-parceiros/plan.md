# Plano — F06 API de parceiros

> Branch `feat/F06-api-parceiros`, worktree própria, **em paralelo com F07** (W4). Ambiente: `export COMPOSE_PROJECT_NAME=catraca-f06 CATRACA_PORT=3106`.
> Cada etapa vale **um commit** (`tipo(F06): descrição`, sem nenhuma linha de coautoria), seguido de `git push`. Cada etapa traz o teste que a acompanha, e `npm run gates` precisa passar a partir da etapa 1.
> O **primeiro commit precisa ser enviado logo no início**: o enunciado exige que o primeiro commit de cada PR da wave paralela seja anterior ao último commit do outro.
> Não importar nada de `src/checkin/` (F07). Referências: [spec](spec.md), [contrato](contract.md), [`architecture.md`](../../architecture.md) §5 (F06).

## Etapa 1 — Esqueleto (commit e push imediatos)
- **Arquivos:**
  - `src/partner/plugin.ts`: `partnerPlugin` encapsulado (sem `fastify-plugin`) registrando `partnerRoutes` com `prefix: '/api/partner'`, só com `GET /events` → `200 []`.
  - `src/features.ts`: +1 linha `partnerPlugin`.
  - `test/f06/events.test.ts` com o teste `plugin de parceiros responde JSON sob /api/partner`.
- **Teste:** `GET /api/partner/events` → 200 com `application/json`; `GET /` (vitrine) continua 200 HTML, ou seja, o escopo não vaza para fora do prefixo.
- **Commit:** `chore(F06): esqueleto do plugin da API de parceiros` → `git push -u origin feat/F06-api-parceiros`.

## Etapa 2 — Autenticação
- **Arquivos:** `src/partner/plugin.ts` → `checkApiKey` em `onRequest` (sha256 + `timingSafeEqual`) e `setNotFoundHandler` do escopo (401 / 404 `not_found`). As rotas `POST /events/:eventId/purchases` e `GET /tickets/:ticketId` entram como stubs que respondem 501, só para a autenticação ser testada nas três rotas (substituídos nas etapas 5 e 6).
- **Testes** (`test/f06/auth.test.ts`):
  - `as três rotas sem X-Api-Key ou com chave errada respondem 401 unauthorized`
  - `a chave é checada antes do parsing: corpo malformado sem chave dá 401`
  - `chave correta passa e o cabeçalho não diferencia maiúsculas`
  - `rota desconhecida sob /api/partner: 401 sem chave e 404 JSON com chave`
- **Commit:** `feat(F06): autenticação X-Api-Key timing-safe`.

## Etapa 3 — Parser de corpo e error handler
- **Arquivos:** `src/partner/plugin.ts` → `removeAllContentTypeParsers` + parser `'*'` como string (`bodyLimit` 16 KiB), `parsePurchaseBody` (media type, `JSON.parse`, objeto simples, `validatePurchaseInput`) e `setErrorHandler` (4xx → 422; resto → 500 JSON).
- **Teste:** `test/f06/robustness.test.ts` › `corpos inválidos respondem 422 invalid_request e nunca 400, 415 ou 500` (a tabela da spec §10, rodando contra a rota de compra, que nesta etapa já faz o parse e a validação antes do stub).
- **Commit:** `feat(F06): parser de corpo próprio e erros sempre JSON`.

## Etapa 4 — Listagem de eventos
- **Arquivos:** `src/partner/plugin.ts` → `GET /events` com `listOnSaleEvents()` e serialização campo a campo (`toIsoWithOffset`).
- **Testes** (`test/f06/events.test.ts`):
  - `lista só eventos published com exatamente id, name, startsAt, priceCents e availableSeats`
  - `availableSeats segue R05: pending e confirmed ocupam, declined não`
  - `evento cancelled por fixture não aparece na listagem`
- **Commit:** `feat(F06): listagem de eventos à venda`.

## Etapa 5 — Compra
- **Arquivos:** `src/partner/plugin.ts` → `POST /events/:eventId/purchases` (corpo → formato do id → `purchaseTicket` → 202/404/409).
- **Testes** (`test/f06/purchases.test.ts`):
  - `compra válida responde 202 com exatamente ticketId, code e status pending`
  - `ordem de erros da compra: 422 antes de 404 antes de 409`
  - `evento cancelled por fixture: compra responde 404 event_not_available`
- E também `test/f06/robustness.test.ts` › `ids em formato inesperado respondem 404 com o erro da rota` (parte do evento).
- **Commit:** `feat(F06): compra pela API via purchaseTicket`.

## Etapa 6 — Consulta de ingresso
- **Arquivos:** `src/partner/plugin.ts` → `GET /tickets/:ticketId` (formato → `findTicketById` → 200/404).
- **Testes** (`test/f06/tickets.test.ts`):
  - `consulta devolve exatamente ticketId, code, eventId, status e checkedIn`
  - `checkedIn reflete tickets.checked_in_at da fixture insertTicket`
  - `status da consulta usa os valores da API para os 5 status`
  - `ingresso inexistente responde 404 ticket_not_found`
- O teste `ids em formato inesperado respondem 404 com o erro da rota` é completado com os casos de `ticketId`.
- **Commit:** `feat(F06): consulta de ingresso pela API`.

## Etapa 7 — Integração com F04/F05 pela UI
- **Arquivos:** `test/f06/integration.test.ts`.
- **Testes:**
  - `XC-F06-F04-01: evento criado pela UI só aparece depois de publicado, com preço, data e lotação da UI`
  - `XC-F06-F05-01: vitrine e API disputam as mesmas vagas`
  - `XC-F06-F05-02: ingresso da vitrine é consultável pela API com o mesmo code e status`
- **Commit:** `test(F06): integração da API com eventos e compras da vitrine`.

## Etapa 8 — Rajada HTTP e gateway
- **Arquivos:** `test/f06/burst.test.ts`, `test/f06/gateway.test.ts`.
- **Testes:**
  - `30 POST simultâneos × 10 rodadas: exatamente 5 respostas 202 e 25 respostas 409`
  - `0001 fica confirmed e 0004 fica pending e depois declined liberando a vaga` (dispatcher de teste em escala 0,01)
- **Commit:** `test(F06): rajada de 30 compras pela API e resultado do gateway`.

## Etapa 9 — Fumaça do contrato, gates, estado e PR
1. `export COMPOSE_PROJECT_NAME=catraca-f06 CATRACA_PORT=3106 && npm run down; npm run up`.
2. Rodar como fumaça **todos** os itens de [`contract.md`](contract.md) (C-F06-01 … C-F06-24), com os helpers dos pré-requisitos e em escala 1. Isso inclui o comando literal do passo 15 em 5 eventos novos (C-F06-22) e `scripts/burst.sh 5` (C-F06-24). Corrigir o que falhar. A fumaça **não** substitui a avaliação independente.
3. `npm run gates` → código 0.
4. `state/project-state.json`: só a entrada `F06` → `"status": "implemented"`, `"branch": "feat/F06-api-parceiros"`. Se a `main` mudou (merge de F07), rebase ou merge mantendo a entrada de F07 intacta.
5. Commit `chore(F06): estado implemented` → `git push`.
6. `gh pr create --base main --head feat/F06-api-parceiros --title "F06: API de parceiros" --body "<resumo; itens C-F06-01…24 atendidos; questões em aberto da spec §11; como testar; wave W4 em paralelo com F07>"`.
7. `npm run down`.
