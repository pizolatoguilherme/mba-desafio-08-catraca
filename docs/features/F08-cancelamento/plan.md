# Plano — F08 Cancelamento

Branch `feat/F08-cancelamento`, criada a partir da `main` com F01–F07 `done`. Ambiente isolado: `export COMPOSE_PROJECT_NAME=catraca-f08 CATRACA_PORT=3108`.
Cada etapa vale **um commit** (`tipo(F08): …`, sem nenhum trailer de coautoria), seguido de `git push`. Só os arquivos da spec §9 são tocados.

## Etapa 1: esqueleto (commit e push imediatos)
- **Arquivos:**
  - `src/cancel/service.ts`: `cancelEvent` com a assinatura final (corpo provisório que devolve `{ ok: false, error: 'not_found' }`).
  - `src/cancel/routes.ts`: `cancelPlugin` vazio.
  - `src/features.ts`: +1 linha.
  - `scripts/flow/evaluator-flow.mjs`: `runFlow` exportada, que por enquanto só faz a pré-checagem `/healthz`, e o `main()` CLI com o parsing de `WEB`/`API`/`KEY`/`FLOW_SCALE` e os códigos de saída.
  - `scripts/flow/evaluator-flow.d.mts`.
  - `package.json`: script `flow`, se ainda não existir.
  - `test/f08/cancel.service.test.ts`: um teste trivial de export.
- **Teste:** `npm run lint && npm run typecheck`. `node scripts/flow/evaluator-flow.mjs` contra o produto no ar imprime `PASS pré-checagem` e, contra uma porta fechada, `FAIL` com `exit 1`.
- **Commit:** `chore(F08): esqueleto de cancelamento e do fluxo do avaliador`. Fazer `git push -u origin feat/F08-cancelamento` logo em seguida.

## Etapa 2: `cancelEvent`
- **Arquivos:** `src/cancel/service.ts` (D1/D2: `lockEvent`, dono, status, `UPDATE events` e um único `UPDATE tickets … CASE`) e `test/f08/cancel.service.test.ts`.
- **Testes:**
  - `C-F08-05 …`: transições, `checked_in_at` preservado e `cancelled_at`.
  - `C-F08-06 …`: `not_found`/`not_cancellable` sem efeito.
  - `C-F08-07`: inspeção (`grep`).
- **Commit:** `feat(F08): cancelEvent transacional sob lockEvent`.

## Etapa 3: corrida cancelamento × gateway
- **Arquivos:** `test/f08/support.ts` (`waitFor`, `startTestDispatcher`, `apiInject`) e `test/f08/cancel.race.test.ts`.
- **Teste:** `C-F08-08 …`. São 20 rodadas, cada uma com um evento novo de lotação 40 e 20 `purchaseTicket` pendentes, seguidas de `Promise.all` com `cancelEvent` e 20 `applyGatewayResult` (aprovado/recusado aleatório, ordem embaralhada, atraso de 0–5 ms). Asserts: o evento termina `cancelled`, há 0 tickets `confirmed` e 0 `pending`, `refunded + cancelled + declined = 20`, nenhuma exceção (deadlock) e todo `applyGatewayResult` que roda depois do cancelamento devolve `false`.
- **Commit:** `test(F08): corrida entre cancelamento e respostas do gateway`.

## Etapa 4: rota e `_cancel.ejs`
- **Arquivos:** `src/cancel/routes.ts` (`requireOrganizer`; 303/404/409 com `renderManagePage(..., { cancelError })`), `src/views/cancel/_cancel.ejs` e `test/f08/cancel.routes.test.ts`.
- **Testes:**
  - `C-F08-10`: botão em `published`, aviso em `cancelled`, nada em `draft`; o POST do dono responde 303.
  - `C-F08-11`: 409 para draft/cancelado, sem efeito.
  - `C-F08-12`: 404 para org B, 403 para participante e 302 para visitante, sem efeito.
- **Commit:** `feat(F08): rota e botão de cancelar evento`.

## Etapa 5: cross-feature com F04, F05 e F03
- **Arquivos:** `test/f08/cancel.cross.test.ts`.
- **Testes:**
  - `C-F08-09` (XC-F08-F03-01): dispatcher local em escala 0,01, cartões `0003` e `0001`. Cancela, espera `idle()` e verifica T5 `cancelled`, T6 `refunded` e `payments` de T5 `done/approved`.
  - `C-F08-13` (XC-F08-F04-01): vitrine, `/events/:id` 404, gestão sem `name="capacity"`/publish, POST de edição e de publicação sem efeito no banco, `getSeatCounts().available === 0` e `listOnSaleEvents` sem o evento.
  - `C-F08-14` (XC-F08-F05-01): `purchaseTicket` → `event_not_available` nos dois canais, POST da vitrine → 404 sem ticket novo, e `/me/tickets` com `estornado`/`cancelado`.
- **Commit:** `test(F08): integração do cancelamento com gateway, eventos e compras`.

## Etapa 6: cross-feature com F06 e F07
- **Arquivos:** `test/f08/cancel.cross.test.ts`.
- **Testes:**
  - `C-F08-15` (XC-F08-F06-01): a listagem da API exclui o evento, a compra responde 404 `event_not_available` e `GET /tickets/:id` mostra `refunded`/`cancelled`.
  - `C-F08-16` (XC-F08-F06-02): compra pela API, confirmada; `checkedIn:false` → check-in `Entrada liberada` → `checkedIn:true`, `status:"confirmed"`.
  - `C-F08-17` (XC-F08-F07-01): check-in de um código antes confirmado → `Evento cancelado`; painel zerado com `R$ 0,00` e Estornados = 2.
- **Commit:** `test(F08): integração do cancelamento com API de parceiros, check-in e painel`.

## Etapa 7: fluxo, infraestrutura e passos 2–8
- **Arquivos:** `scripts/flow/evaluator-flow.mjs`. A infraestrutura inclui:
  - a classe `Session` (cookie jar com `getSetCookie()`, `redirect: 'manual'`, `form()`/`json()`);
  - os extratores HTML (`metric`, `checkinResult`, `ticketRows`, `inputValue`, `hasFormAction`);
  - `within(ms)`/`after(ms)` com escala e slack (D9);
  - `poll(fn, deadline)`;
  - o relatório PASS/FAIL;
  - os passos 2 a 8 (spec §8).
- **Teste:** rodar contra o produto no ar (`npm run up`, escala 1). Os passos 2–8 imprimem `PASS`, e o passo 8 leva ≥ 45 s desde o passo 6.
- **Commit:** `feat(F08): fluxo do avaliador, passos 2 a 8`.

## Etapa 8: fluxo, passos 9–16
- **Arquivos:** `scripts/flow/evaluator-flow.mjs` (passos 9 a 16 da spec §8, incluindo os 30 `fetch` simultâneos do passo 15 para E4 e E5).
- **Teste:** `npm run flow` contra o produto no ar, em escala 1, termina com `FLOW OK` e `exit 0`. `KEY=chave-errada npm run flow` termina com `FAIL passo 2` e `exit 1`.
- **Commit:** `feat(F08): fluxo do avaliador, passos 9 a 16`.

## Etapa 9: fluxo em escala reduzida nos gates
- **Arquivos:** `test/f08/flow.integration.test.ts` e, se indispensável (spec §11, Q2), ajuste mínimo de lint/tsconfig/.dockerignore, registrado no PR.
- **Teste:** `C-F08-04 …`. `app.listen({ port: 0 })`, dispatcher local `SimulatedGateway({ scale: 0.1 })` com `pollMs: 50` e `runFlow({ web, api: web, key: config.partnerApiKey, scale: 0.1 })` → `ok: true` com os passos 2–16. Timeout 180 s.
- **Commit:** `test(F08): fluxo do avaliador em escala reduzida nos gates`.

## Etapa 10: fumaça do contrato, gates, estado e PR
- `npm run gates` precisa terminar com código 0 (C-F08-01).
- `npm run down; npm run up`, em escala 1. Em seguida:
  - `npm run flow` **duas vezes seguidas**, e as duas terminam com `FLOW OK` (C-F08-02);
  - `KEY=chave-errada npm run flow` termina com `exit 1` (C-F08-03);
  - itens ao vivo `C-F08-18` … `C-F08-21` com os helpers do contrato;
  - testes nomeados com `vt`;
  - `npm run down`.
- Atualizar `state/project-state.json`, **somente** a entrada `F08`: `"status": "implemented"`, `"branch": "feat/F08-cancelamento"` (e `"pr"` depois de abrir o PR).
- **Commit:** `chore(F08): estado implemented`. Depois, `git push`.
- Abrir o PR: `gh pr create --base main --head feat/F08-cancelamento --title "F08: Cancelamento" --body "<resumo, itens C-F08-01…21, saída do npm run flow, desvios registrados>"`.
