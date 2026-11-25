# Plano — F07 Check-in & Painel

Branch `feat/F07-checkin-painel`, criada a partir da `main` com F01–F05 `done`. Ambiente isolado da worktree: `export COMPOSE_PROJECT_NAME=catraca-f07 CATRACA_PORT=3107`.
Cada etapa vale **um commit** (`tipo(F07): …`, sem nenhum trailer de coautoria), seguido de `git push`. Nenhuma etapa toca arquivos fora da lista da spec §8.

## Etapa 1: esqueleto (commit e push imediatos)
- **Arquivos:**
  - `src/checkin/service.ts`: `CHECKIN_MESSAGES` final e `checkIn` com a assinatura final (corpo provisório que devolve `'invalid'`).
  - `src/checkin/panel.ts`: `getPanel` com a assinatura final (devolve zeros).
  - `src/checkin/routes.ts`: `checkinPlugin` vazio.
  - `src/features.ts`: +1 linha `checkinPlugin`.
  - `test/f07/checkin.service.test.ts`: só o teste `C-F07-02`.
- **Teste:** `C-F07-02 CHECKIN_MESSAGES tem as 5 mensagens literais do brief` (deep equal com os textos de R10). `npm run lint && npm run typecheck` passam.
- **Commit:** `chore(F07): esqueleto de check-in e painel`. Fazer `git push -u origin feat/F07-checkin-painel` **logo em seguida**, para comprovar o paralelismo com F06.

## Etapa 2: `getPanel`
- **Arquivos:** `src/checkin/panel.ts` (consulta agregada única com `FILTER` e `::int`, mais `getSeatCounts`) e `test/f07/panel.test.ts`.
- **Teste:** `C-F07-11 …`, com um mix de fixtures (`insertTicket`): confirmados com preços 10000/10000/15000 (um com check-in), 2 pendentes, 1 recusado, 1 cancelado, 2 estornados (um com check-in) → `{ confirmed: 3, pending: 2, checkins: 1, available: capacidade − 5, revenueCents: 35000, refunded: 2 }`. Evento cancelado por fixture → `available: 0`.
- **Commit:** `feat(F07): getPanel com definições de R12`.

## Etapa 3: seção `'panel'` e `_panel.ejs`
- **Arquivos:** `src/checkin/routes.ts` (`registerManageSection('panel', …)` com `formatBRL`), `src/views/checkin/_panel.ejs` e `test/f07/panel.test.ts`.
- **Antes de escrever:** ler `src/events/manage-sections.ts` na `main` para confirmar como `buildManageLocals` mescla as seções (spec §10, Q1).
- **Teste:** `C-F07-12 …`. O GET `/org/events/:id` do dono contém os 6 `data-metric` com os valores esperados, `R$ 350,00` com U+0020 e sem ` ` nem `&nbsp;`, e `R$ 0,00` num evento sem vendas.
- **Commit:** `feat(F07): painel na página de gestão`.

## Etapa 4: `checkIn` com a ordem de R10 e a normalização
- **Arquivos:** `src/checkin/service.ts` (`withTransaction`, evento `FOR SHARE`, ticket `FOR UPDATE`, ordem D2, `normalizeCode`) e `test/f07/checkin.service.test.ts`.
- **Testes:** `C-F07-03` … `C-F07-09` (inexistente/vazio; outro evento; R10-1 antes de R10-2; evento cancelado por fixture; não confirmado, inclusive `declined` com check-in; `ok` grava `checked_in_at` e o repetido dá `used`; normalização `' k7q2m9xa '`).
- **Commit:** `feat(F07): check-in com ordem de R10`.

## Etapa 5: concorrência do check-in
- **Arquivos:** `test/f07/checkin.service.test.ts`. Ajustes em `service.ts` só se o teste falhar.
- **Testes:**
  - `C-F07-10 …`: 10 rodadas, cada uma com um ticket confirmado novo e `Promise.all` de 10 `checkIn` com o mesmo código (variando a caixa e os espaços). O resultado tem exatamente 1 `ok` e 9 `used`, e `checked_in_at` é gravado uma vez.
  - `C-F07-24`: inspeção (`grep`) de `FOR UPDATE` e `FOR SHARE`.
- **Commit:** `test(F07): check-in concorrente do mesmo código`.

## Etapa 6: rota `POST /org/events/:id/checkin` e `_checkin.ejs`
- **Arquivos:** `src/checkin/routes.ts` (`requireOrganizer` → `getOwnedEvent` → `checkIn` → `renderManagePage(reply, event, user.id, { checkinResult, checkinResultKey })`), `src/views/checkin/_checkin.ejs` e `test/f07/routes.test.ts`.
- **Testes:**
  - `C-F07-13`: o dono recebe 200 com `<p data-checkin-result="ok">Entrada liberada</p>` e Check-ins 1 na mesma resposta.
  - `C-F07-14`: org B recebe 404 sem nome nem `data-metric`, e `checked_in_at` fica nulo.
  - `C-F07-15`: participante recebe 403 e visitante recebe 302 para `/login`.
- **Commit:** `feat(F07): rota e formulário de check-in`.

## Etapa 7: testes cross-feature com F04/F05
- **Arquivos:** `test/f07/support.ts` (`startTestDispatcher`, `waitFor`) e `test/f07/cross.test.ts`.
- **Testes:**
  - `C-F07-16` (XC-F07-F04-01): lotação 2 → 3 via `POST /org/events/:id` com 2 ocupados. O painel passa de 0 para 1 e o valor é igual a `getSeatCounts`.
  - `C-F07-17` (XC-F07-F05-01): passo 9 do brief. Duas compras confirmadas a R$ 100 (uma `web`, uma `partner`), o preço muda para R$ 150 pela rota de edição e mais uma compra `partner` é confirmada. Resultado: Confirmados 3, Pendentes 0, Vagas 0, Receita `R$ 350,00` e `price_cents` [10000, 10000, 15000].
  - `C-F07-18` (XC-F07-F05-02): código `web` confirmado → `ok`; `partner` pendente → `notConfirmed`; `partner` com o cartão `0002` (recusado) → `notConfirmed`; código confirmado de outro evento → `invalid`.
- **Commit:** `test(F07): integração do check-in e do painel com compras e eventos`.

## Etapa 8: rajada em escala 1 (XC-F07-F05-03)
- **Arquivos:** `test/f07/burst.test.ts`.
- **Teste:** `C-F07-19 …`. Dispatcher local com `SimulatedGateway({ scale: 1 })` e `pollMs: 250`. São feitas 30 chamadas `purchaseTicket` simultâneas (`partner`, `4000000000000001`) em evento novo de lotação 5, com 3 rodadas. Em cada rodada, 5 `ok` e 25 `sold_out`, e em ≤ 10 s, contados a partir do disparo, `getPanel` e o HTML da página de gestão mostram Confirmados 5, Pendentes 0, Vagas 0 e Receita = 5 × preço. Timeout de 60 s.
- **Commit:** `test(F07): painel após rajada de 30 compras`.

## Etapa 9: fumaça do contrato, gates, estado e PR
- `npm run gates` precisa terminar com código 0 (C-F07-01).
- Rodar `npm run up` com escala 1 e executar, como fumaça, os itens ao vivo `C-F07-20` … `C-F07-23` do `contract.md`, com os helpers dos pré-requisitos. Rodar também os testes nomeados com o wrapper `vt`. Depois, `npm run down`.
- Atualizar `state/project-state.json`, **somente** a entrada `F07`: `"status": "implemented"`, `"branch": "feat/F07-checkin-painel"` (e `"pr"` depois de abrir o PR).
- **Commit:** `chore(F07): estado implemented`. Depois, `git push`.
- Abrir o PR: `gh pr create --base main --head feat/F07-checkin-painel --title "F07: Check-in & Painel" --body "<resumo, itens C-F07-01…24 atendidos, como testar>"`.
- Se a `main` já tiver recebido F06, rebasear e resolver os conflitos triviais em `src/features.ts` e `state/project-state.json`.
