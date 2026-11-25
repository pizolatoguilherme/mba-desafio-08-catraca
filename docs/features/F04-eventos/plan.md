# Plano — F04 Eventos

- **Branch:** `feat/F04-eventos` (a partir da `main` com F01, F02 e F03 `done`). Wave W2.
- **Ambiente isolado da worktree:** `export COMPOSE_PROJECT_NAME=catraca-f04 CATRACA_PORT=3104`.
- Cada etapa vale **um commit** `tipo(F04): …` (sem nenhum trailer de coautoria, conforme AGENTS.md), com push logo em seguida.
- Para iterar mais rápido: `npm run gates -- test/f04/<arquivo> --reporter=verbose` (F01 D6: só o vitest, com Postgres efêmero).

## Etapa 1 — Esqueleto (commit + push imediato)

- Arquivos:
  - `src/events/{repo,validation,manage-sections,routes-public,routes-org}.ts` com as assinaturas da spec §4. Os corpos são provisórios (`throw new Error('F04: não implementado')`) e os plugins de rotas ficam vazios;
  - os 4 partials vazios (`purchases/_buy.ejs`, `checkin/_panel.ejs`, `checkin/_checkin.ejs`, `cancel/_cancel.ejs`);
  - a linha de F04 em `src/features.ts`;
  - `test/f04/_support.ts`.
- Teste: `test/f04/manage.test.ts` › "os partials dos slots existem e não renderizam nada" (renderiza cada partial com `ejs.renderFile` e espera que o resultado, depois de `trim()`, seja vazio).
- Commit: `feat(F04): esqueleto de eventos e partials vazios` → `git push -u origin feat/F04-eventos`.

## Etapa 2 — Validação e formatadores

- Arquivos: `src/events/validation.ts`, `test/f04/validation.test.ts`.
- Testes: "validateEventInput aceita entrada válida e converte os valores"; "validateEventInput rejeita cada campo com a mensagem definida"; "validateEventInput rejeita data de início no passado"; "formatadores de data e preço usam America/Sao_Paulo".
- Commit: `feat(F04): validação de evento com mensagens PT-BR`.

## Etapa 3 — Repositório

- Arquivos: `src/events/repo.ts`, `test/f04/repo.test.ts`.
- Implementa: `lockEvent`, `getSeatCounts`, `listOnSaleEvents`, `getOwnedEvent`, `getPublicEvent`, `listOwnedEvents` e `createOwnedEvent`.
- Testes: "getSeatCounts conta pending e confirmed e zera em evento cancelado"; "listOnSaleEvents devolve só published com available"; "getOwnedEvent e getPublicEvent filtram dono e status"; "lockEvent bloqueia uma segunda transação até o commit".
- Commit: `feat(F04): repositório de eventos e contagem de vagas`.

## Etapa 4 — Vitrine e página pública

- Arquivos: `src/events/routes-public.ts` (registra `GET /`; o placeholder de F01 deixa de ser registrado sozinho, F01 D12), `src/views/events/{showcase,show}.ejs`, `test/f04/public.test.ts`. Não edita `src/server.ts` nem `home.ejs`.
- Testes: "vitrine lista publicados com nome, data, local, preço e vagas"; "rascunho e cancelado ficam fora da vitrine e respondem 404"; "página do evento inclui o slot de compra".
- Commit: `feat(F04): vitrine e página pública do evento`.

## Etapa 5 — Área do organizador: lista e criação

- Arquivos: `src/events/routes-org.ts`, `src/views/org/{list,new}.ejs`, `test/f04/org.test.ts`.
- Testes: "criação válida grava rascunho do organizador logado"; "criação inválida responde 422 e re-renderiza o formulário"; "lista de eventos mostra só os do organizador logado"; "visitante é redirecionado e participante recebe 403".
- Commit: `feat(F04): lista e criação de eventos do organizador`.

## Etapa 6 — Página de gestão e seções

- Arquivos: `src/events/manage-sections.ts`, `src/views/org/manage.ejs`, `src/events/routes-org.ts` (`GET /org/events/:id`), `test/f04/manage.test.ts`.
- Testes: "página de gestão mostra id, dados, edição, publicar e slots"; "registerManageSection injeta o retorno em buildManageLocals"; "renderManagePage aplica o status e os extras do chamador"; "outro organizador recebe 404 sem dados em GET e POST" (só a parte GET nesta etapa; os POSTs entram nas etapas 7 e 8).
- Commit: `feat(F04): página de gestão com slots de painel, check-in e cancelamento`.

## Etapa 7 — Edição sob lock

- Arquivos: `src/events/repo.ts` (`updateOwnedEvent`), `src/events/routes-org.ts` (`POST /org/events/:id`), `test/f04/edit.test.ts`.
- Testes: "edição valida os campos como na criação"; "lotação abaixo das vagas ocupadas é rejeitada e igual ou acima é aceita"; "edição espera o lock do evento e usa as vagas ocupadas atuais"; "mudar o preço não altera o price_cents de ingressos existentes".
- Commit: `feat(F04): edição de evento com lotação mínima sob lock`.

## Etapa 8 — Publicação e guards de evento cancelado

- Arquivos: `src/events/repo.ts` (`publishOwnedEvent`), `src/events/routes-org.ts` (`POST /org/events/:id/publish` + guard 409 de cancelado na edição), `test/f04/publish.test.ts`, `test/f04/manage.test.ts`, `test/f04/org.test.ts`.
- Testes: "publicação aceita só rascunho"; "duas publicações simultâneas resultam em uma 303 e uma 409"; "evento cancelado não mostra edição nem publicar e rejeita POSTs"; "outro organizador recebe 404 sem dados em GET e POST" (completo: GET, edição e publicação).
- Commit: `feat(F04): publicação e bloqueio de evento cancelado`.

## Etapa 9 — Fumaça do contrato, gates, estado e PR

1. `npm run down; npm run up` e execução de **todos** os itens de `contract.md` (C-F04-01 … C-F04-23), na ordem, conferindo os resultados esperados. Isso é fumaça, não avaliação.
2. `npm run gates` → código 0.
3. `state/project-state.json`: somente a entrada `F04` → `"status": "implemented"` e `"branch": "feat/F04-eventos"` (mais `updatedAt`).
4. Commit `chore(F04): estado implemented`, push, e `gh pr create --base main --head feat/F04-eventos --title "F04: Eventos" --body "<resumo; itens C-F04 atendidos; como testar; linha em src/features.ts (D15); adições de interface (spec §4.2)>"`.
5. `npm run down`.
