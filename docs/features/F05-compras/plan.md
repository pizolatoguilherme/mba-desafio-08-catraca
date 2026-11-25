# Plano — F05 Compras & Meus ingressos

> Branch `feat/F05-compras`, worktree própria. Ambiente: `export COMPOSE_PROJECT_NAME=catraca-f05 CATRACA_PORT=3105`.
> Cada etapa vale **um commit** (`tipo(F05): descrição`, sem nenhuma linha de coautoria), seguido de `git push`. Cada etapa traz o teste que a acompanha. `npm run gates` precisa passar a partir da etapa 1.
> Referências: [spec](spec.md), [contrato](contract.md), [`architecture.md`](../../architecture.md) §5 (F05).

## Etapa 1 — Esqueleto (commit e push imediatos)
- **Arquivos:**
  - `src/purchases/service.ts`: tipos `TicketRow` e `PurchaseError`; as assinaturas de `validatePurchaseInput`, `purchaseTicket`, `findTicketById`, `findTicketByCode`, `listTicketsForUser` e `insertTicketWithUniqueCode`, com corpo `throw new Error('not implemented')`.
  - `src/purchases/routes.ts`: `purchasesPlugin` vazio.
  - `src/features.ts`: +1 linha `purchasesPlugin`.
  - `src/views/purchases/my-tickets.ejs`: só o `<h1>Meus ingressos</h1>`.
  - `test/f05/service.test.ts` com o teste `módulo de compras exporta a interface do architecture.md`, que checa `typeof` de cada export.
- **Teste:** o teste de exports passa; `npm run gates` verde.
- **Commit:** `chore(F05): esqueleto de compras` → `git push -u origin feat/F05-compras`.

## Etapa 2 — `validatePurchaseInput`
- **Arquivos:** `src/purchases/service.ts` (regex de e-mail, `typeof` string, `isValidCardNumber` de F03).
- **Teste:** `test/f05/validation.test.ts` › `validatePurchaseInput aceita só e-mail bem formado e cartão string de 16 dígitos` (tabela da spec §12.1).
- **Commit:** `feat(F05): validação da entrada de compra`.

## Etapa 3 — Inserção com código único
- **Arquivos:** `src/purchases/service.ts` → `insertTicketWithUniqueCode(c, row, genCode = newTicketCode)` com `INSERT … ON CONFLICT (code) DO NOTHING RETURNING id, code` e até 5 tentativas.
- **Teste:** `test/f05/service.test.ts` › `código de 8 caracteres do alfabeto A-Z2-9 e nova tentativa em colisão` (fixture com código `AAAAAAAA` já usado; gerador injetado devolve `AAAAAAAA` e depois `BBBBBBBB`; resultado `BBBBBBBB`, gerador chamado 2 vezes; com `newTicketCode` real, o código casa com `^[A-Z2-9]{8}$`).
- **Commit:** `feat(F05): código de ingresso único com nova tentativa`.

## Etapa 4 — `purchaseTicket` com lock do evento
- **Arquivos:** `src/purchases/service.ts`: `purchaseTicket` na ordem da spec §7 (`validatePurchaseInput` → `withTransaction` { `lockEvent`; status; `getSeatCounts(c)`; insert; `enqueuePayment` } → `dispatcher.kick()`).
- **Testes** (`test/f05/service.test.ts`):
  - `ordem dos erros: invalid_request, event_not_available, sold_out`
  - `compra cria ingresso pending com price_cents do evento e pagamento requested`
  - `mudança de preço posterior não altera o price_cents do ingresso`
  - `ingresso pendente ocupa vaga`
  - `canal partner sem userId conta na lotação`
  - `kick do dispatcher é chamado só em sucesso e depois do commit`
- **Commit:** `feat(F05): purchaseTicket com lock de evento na compra`.

## Etapa 5 — Prova de R07
- **Arquivos:** `test/f05/concurrency.test.ts`.
- **Testes:**
  - `R07: 30 compras simultâneas × 20 rodadas, lotação 5, ocupadas nunca passam de 5` (pré-condição `pool.options.max >= 31`, amostrador do máximo, asserções da spec §12.2)
  - `controle: check-then-insert sem lock vende além da lotação`
  - `purchaseTicket espera o lockEvent de outra transação`
- **Commit:** `test(F05): prova de lotação sob 30 compras simultâneas`.

## Etapa 6 — Consultas de ingresso
- **Arquivos:** `src/purchases/service.ts` → `findTicketById`, `findTicketByCode` (trim + upper) e `listTicketsForUser` (JOIN com `events`, `ORDER BY created_at DESC, id`).
- **Teste:** `test/f05/service.test.ts` › `findTicketById, findTicketByCode e listTicketsForUser` (inexistente → `null`; código com espaços e em minúsculas encontra; lista só o `user_id` pedido, com `event_name`).
- **Commit:** `feat(F05): consultas de ingresso por id, código e participante`.

## Etapa 7 — Gateway ponta a ponta (escala reduzida)
- **Arquivos:** `test/f05/gateway.test.ts` (dispatcher de teste `createDispatcher({ gateway: new SimulatedGateway({ scale: 0.01 }), pollMs: 20 })`, com `start()`/`stop()`).
- **Teste:** `0001 vira confirmed e 0002 vira declined liberando a vaga`.
- **Commit:** `test(F05): resultado do gateway aplicado à compra`.

## Etapa 8 — Compra na vitrine
- **Arquivos:**
  - `src/purchases/routes.ts`: `POST /events/:id/purchase` (`requireParticipant`, `getPublicEvent` → 404, mapeamento 303/422/404/409; 409/422 re-renderizam com `renderEventPage` de F04) e `GET /events/:id/purchase` (303).
  - `src/views/purchases/_buy.ejs`: formulário, `Ingressos esgotados`, link de login e aviso para organizador, lendo `locals.soldOut`/`locals.purchaseError`.
- **Testes** (`test/f05/web-purchase.test.ts`):
  - `visitante é redirecionado para /login e organizador recebe 403`
  - `participante compra: 303 para /me/tickets em menos de 1 s, ingresso pending da sessão`
  - `cartão inválido: 422 com mensagem e nenhum ingresso criado`
  - `evento draft, cancelled ou inexistente: 404 sem dados e nenhum ingresso`
  - `sem vaga: Ingressos esgotados no lugar do formulário e POST responde 409`
- **Commit:** `feat(F05): compra pela vitrine e Ingressos esgotados`.

## Etapa 9 — Meus ingressos
- **Arquivos:** `src/purchases/routes.ts` (`GET /me/tickets`), `src/views/purchases/my-tickets.ejs` (tabela da spec §9, um `<tr>` por linha de HTML), `src/views/layout.ejs` (+1 link para participante).
- **Testes** (`test/f05/my-tickets.test.ts`):
  - `rótulos em português, código e nome do evento; só os do próprio participante`
  - `ingresso partner com o mesmo e-mail do participante não aparece`
- **Commit:** `feat(F05): página Meus ingressos`.

## Etapa 10 — Cross-feature com F04
- **Arquivos:** `test/f05/cross-feature.test.ts`.
- **Teste:** `XC-F05-F04-01: pendentes contam na redução de lotação da edição de F04` (lotação 2 com 2 `pending` → editar para 1 dá 422 e a lotação continua 2 → editar para 3 é aceito → nova compra 303).
- **Commit:** `test(F05): integração da compra com a edição de lotação`.

## Etapa 11 — Fumaça do contrato, gates, estado e PR
1. `export COMPOSE_PROJECT_NAME=catraca-f05 CATRACA_PORT=3105 && npm run down; npm run up`.
2. Rodar como fumaça **todos** os itens de [`contract.md`](contract.md) (C-F05-01 … C-F05-28), na ordem, com os helpers dos pré-requisitos. Os itens de tempo real (C-F05-21, C-F05-23, C-F05-24, C-F05-27) rodam em escala 1. Corrigir o que falhar antes de seguir. A fumaça **não** substitui a avaliação independente.
3. `npm run gates` → código 0.
4. `state/project-state.json`: só a entrada `F05` → `"status": "implemented"`, `"branch": "feat/F05-compras"`. Nenhuma outra entrada muda.
5. Commit `chore(F05): estado implemented` → `git push`.
6. `gh pr create --base main --head feat/F05-compras --title "F05: Compras & Meus ingressos" --body "<resumo; itens C-F05-01…28 atendidos; acréscimos de interface da spec §13 (findTicketByCode, TicketRow, data-ticket-id, GET /events/:id/purchase, link no layout); como testar>"`.
7. `npm run down`.
