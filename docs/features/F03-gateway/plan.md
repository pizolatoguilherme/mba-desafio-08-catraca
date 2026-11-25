# Plano — F03 Gateway simulado & Dispatcher

- **Branch:** `feat/F03-gateway` (a partir da `main` com F01 `done`). Wave W1, em paralelo com F02.
- **Ambiente isolado da worktree:** `export COMPOSE_PROJECT_NAME=catraca-f03 CATRACA_PORT=3103`.
- Cada etapa vale **um commit** `tipo(F03): …` (sem nenhum trailer de coautoria, conforme AGENTS.md), com push logo em seguida.
- Os testes rodam via `npm run gates`. Para iterar mais rápido numa etapa: `npm run gates -- test/f03/<arquivo> --reporter=verbose` (F01 D6: só o vitest, com Postgres efêmero).
- F03 **não** toca em `test/helpers.ts` nem em `src/features.ts` (evita conflito com F02).

## Etapa 1 — Esqueleto (commit + push imediato)

- Arquivos:
  - `src/gateway/card.ts` (implementação completa: são duas linhas),
  - `src/gateway/simulated.ts`, `src/gateway/dispatcher.ts`, `src/gateway/index.ts` com as assinaturas exatas da spec §4 e corpos provisórios (`throw new Error('F03: não implementado')`; `createDispatcher` devolve um objeto com métodos no-op),
  - `test/f03/card.test.ts`.
- Teste: `card.test.ts` › "isValidCardNumber aceita exatamente 16 dígitos", "isValidCardNumber rejeita entradas inválidas", "cardLast4 devolve os 4 últimos dígitos".
- Commit: `feat(F03): esqueleto do gateway e validação de cartão` → `git push -u origin feat/F03-gateway` **logo no início** (é a prova do paralelismo com F02).

## Etapa 2 — `decide()` e `SimulatedGateway`

- Arquivos: `src/gateway/simulated.ts`, `test/f03/simulated.test.ts`.
- Implementa a tabela da spec §4.1 (fórmula D1), a escala, o `unref()` e o `RangeError`.
- Testes: "decide aplica a tabela de finais com rnd nos extremos"; "SimulatedGateway em escala 1 responde 0001 e 0002 entre 2 e 4 s medidos"; "GATEWAY_DELAY_SCALE 0,01 faz o 0003 responder entre 300 e 400 ms"; "a escala multiplica os atrasos de todos os finais"; "SimulatedGateway rejeita escala inválida".
- Commit: `feat(F03): gateway simulado com tabela de finais e escala`.

## Etapa 3 — `enqueuePayment` e helpers de teste

- Arquivos: `src/gateway/dispatcher.ts` (só `enqueuePayment`), `test/f03/_support.ts`, `test/f03/enqueue.test.ts`.
- Testes: "enqueuePayment grava requested e retorna em menos de 200 ms com 0003"; "enqueuePayment participa da transação do chamador"; "enqueuePayment rejeita cardLast4 que não tem 4 dígitos".
- Commit: `feat(F03): enqueuePayment na transação do chamador`.

## Etapa 4 — `applyGatewayResult` com guarda e lock

- Arquivos: `src/gateway/dispatcher.ts`, `test/f03/apply.test.ts`, `test/f03/_support.ts` (`cancelEventFixture`, que é o SQL de cancelamento de architecture §5/F08 sob `FOR UPDATE`).
- Testes: "applyGatewayResult confirma ou recusa ticket pending e fecha o pagamento"; "applyGatewayResult não altera ticket que não está pending"; "applyGatewayResult não confirma ticket de evento cancelado"; "applyGatewayResult espera o lock do evento e respeita o cancelamento"; "corrida: cancelamento contra 20 respostas simultâneas nunca deixa confirmed".
- Commit: `feat(F03): aplicação guardada do resultado do gateway`.

## Etapa 5 — `createDispatcher` (laço, coleta, kick, idle, stop)

- Arquivos: `src/gateway/dispatcher.ts`, `test/f03/dispatcher.test.ts`.
- Implementa D4–D6 e D9–D11: coleta com `SKIP LOCKED`, disparo concorrente, kicks coalescidos, geração, requeue em erro.
- Testes: "dispatcher aplica o resultado de cada final"; "dispatcher coleta por polling sem kick"; "kick e idle processam imediatamente"; "kick com o dispatcher parado não processa nada"; "stop interrompe a coleta"; "falha ao aplicar devolve o pagamento para requested".
- Commit: `feat(F03): dispatcher concorrente com polling e kick`.

## Etapa 6 — Recuperação no `start()`

- Arquivos: `src/gateway/dispatcher.ts`, `test/f03/recovery.test.ts`.
- Implementa D8 (reset `in_flight → requested` antes da primeira coleta).
- Teste: "start devolve in_flight para requested e processa os pendentes".
- Commit: `feat(F03): recuperação de pagamentos em voo no arranque`.

## Etapa 7 — Latência e concorrência em escala 1

- Arquivos: `test/f03/latency.test.ts`. Ajustes de desempenho em `dispatcher.ts`, se o teste mostrar necessidade.
- Teste: "5 pagamentos 0001 confirmados em até 5 s, 10 rodadas em escala 1" (sem `kick`, `pollMs` 250; timeout do teste: 120 s).
- Commit: `test(F03): latência e concorrência do dispatcher em escala 1`.

## Etapa 8 — Singleton e arranque no servidor

- Arquivos: `src/gateway/index.ts` (singleton com `config`), `src/server.ts` (import + bloco D12, nada mais), `test/f03/server.test.ts`.
- Testes: "buildApp inicia o dispatcher e app.close o para"; "buildApp com startDispatcher false não inicia o dispatcher".
- Commit: `feat(F03): dispatcher inicia com o servidor e para no close`.

## Etapa 9 — Script `enqueue-demo`

- Arquivos: `src/gateway/enqueue-demo.ts`, `test/f03/enqueue-demo.test.ts`.
- Implementa a spec §4.4: `runDemo` exportado e CLI ativado só quando o arquivo é o executado (`import.meta.url === pathToFileURL(process.argv[1]).href`). O CLI faz `pool.end()` ao final e usa os códigos de saída 0, 1 e 2.
- Teste: "runDemo enfileira com enqueuePayment e reporta o status final". Também roda contra o produto: `npm run up` e `docker compose exec -T app node dist/gateway/enqueue-demo.js` → uma linha JSON `confirmed`.
- Commit: `feat(F03): script enqueue-demo para verificação no produto`.

## Etapa 10 — Fumaça do contrato, gates, estado e PR

1. `npm run down; npm run up` (escala 1, sem `GATEWAY_DELAY_SCALE` no shell) e execução de **todos** os itens de `contract.md` (C-F03-01 … C-F03-21), na ordem, conferindo os resultados esperados. Isso é fumaça, não avaliação.
2. `npm run gates` → código 0.
3. `state/project-state.json`: somente a entrada `F03` → `"status": "implemented"` e `"branch": "feat/F03-gateway"` (mais `updatedAt`). Não altera as outras features.
4. Commit `chore(F03): estado implemented`, push, e `gh pr create --base main --head feat/F03-gateway --title "F03: Gateway simulado & Dispatcher" --body "<resumo; itens C-F03 atendidos; como testar; alteração em src/server.ts (D12)>"`.
5. `npm run down`.
