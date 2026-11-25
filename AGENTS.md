# AGENTS.md — porta de entrada dos agentes

Este é o repositório da **Catraca**, um MVP de venda de ingressos para eventos pequenos, construído em modo agente com SDD.
Todo agente (implementador, avaliador, corretor) lê este arquivo antes de qualquer ação.

## Comandos

| Ação | Comando | Observação |
|---|---|---|
| Subir tudo (build + migrações + seed + app) | `npm run up` | Funciona num clone limpo, sem `npm install`. Produto em `http://localhost:${CATRACA_PORT:-3000}` |
| Derrubar tudo | `npm run down` | Encerra todos os containers do projeto (o volume do banco é mantido; a seed é idempotente) |
| Gates (lint + typecheck + testes) | `npm run gates` | Roda em um compose isolado (`<projeto>-gates`), com Postgres efêmero, e derruba tudo ao final |
| Fluxo do avaliador (modo padrão) | `npm run flow` | Executa os passos 2–16 do enunciado contra o produto que está no ar |
| Rajada de concorrência (passo 15) | `scripts/burst.sh [rodadas]` | Cria eventos novos com lotação 5 e dispara 30 compras simultâneas por rodada |
| Verificar artefatos de entrega | `npm run verify:delivery` | Checa PRD, specs, contratos, relatórios, estado e PRs paralelos |

Variáveis úteis (todas têm default; nenhuma é obrigatória):

- `CATRACA_PORT` (default `3000`): porta publicada no host.
- `COMPOSE_PROJECT_NAME` (default `catraca`): use um nome único por worktree (ex.: `catraca-f05`) junto com uma porta única (ex.: `3105`).
- `GATEWAY_DELAY_SCALE` (default `1`): multiplica os atrasos do gateway simulado. **Só** os testes usam valores < 1; o modo padrão é `1`.
- `PARTNER_API_KEY` (default documentado no README).

## Regras do projeto (obrigatórias)

1. **SDD:** nada é implementado sem PRD → spec → plano → contrato. A fonte de verdade das regras de negócio é [`docs/brief.md`](docs/brief.md) (R01–R13, gateway, API de parceiros). O PRD é [`docs/PRD.md`](docs/PRD.md).
2. **Contrato é lei:** o implementador entrega o que o contrato da feature exige. O avaliador verifica exatamente os itens do contrato.
3. **Quem implementa não avalia.** A avaliação é feita por um agente de contexto vazio, que não recebe nada do que o implementador disse.
4. **Relatórios são imutáveis.** Cada avaliação cria um arquivo **novo** em `docs/features/<feature>/reports/AAAAMMDD-HHMMSS-<sha7>.md`, adicionado em um commit próprio. Um relatório nunca é editado, renomeado, reformatado ou apagado depois de commitado. Uma reavaliação gera outro arquivo.
5. **Estado único:** [`state/project-state.json`](state/project-state.json) guarda o status de cada feature e o caminho do relatório mais recente. Ele precisa bater com a realidade.
6. **Commits:** mensagens no formato `tipo(Fxx): descrição` (ex.: `feat(F05): lock de evento na compra`). **Nunca** inclua trailers de coautoria do Claude (`Co-Authored-By: Claude …`) nem qualquer linha de coautoria de IA.
7. **Uma feature por branch** (`feat/Fxx-slug`), integrada à `main` por PR. Ninguém faz commit direto na `main` com código de feature.
8. **Gates verdes antes do PR:** `npm run gates` precisa passar na branch.
9. **Não toque no que não é seu:** altere apenas os arquivos que a spec da feature prevê. Se precisar mudar uma interface provida por outra feature, registre isso na spec e no PR.
10. **Schema:** o schema completo nasce em F01. As features seguintes não criam migrações; se uma for indispensável, use prefixo de timestamp (`migrations/20261125T1530_<nome>.sql`) para não colidir em waves paralelas.
11. **Mensagens e rótulos literais:** as mensagens de R07/R10, os rótulos de status e o contrato da API de parceiros são copiados exatamente como estão em `docs/brief.md`.

## Mapa dos artefatos

| Artefato | Caminho |
|---|---|
| Enunciado / brief (fonte de verdade) | [`docs/brief.md`](docs/brief.md) |
| PRD (features, provê/consome, grafo, waves, critérios) | [`docs/PRD.md`](docs/PRD.md) |
| Arquitetura compartilhada (schema, interfaces, rotas) | [`docs/architecture.md`](docs/architecture.md) |
| Spec, plano, contrato e relatórios de cada feature | `docs/features/Fxx-slug/{spec.md,plan.md,contract.md,reports/}` |
| Estado do projeto | [`state/project-state.json`](state/project-state.json) |
| Prompts dos agentes | [`prompts/implementer.md`](prompts/implementer.md), [`prompts/evaluator.md`](prompts/evaluator.md), [`prompts/fixer.md`](prompts/fixer.md) |
| Scripts do harness | [`scripts/`](scripts/) |
| Validação final | [`docs/final-validation/`](docs/final-validation/) |

Features:

| ID | Pasta |
|---|---|
| F01 Fundação & Harness | [`docs/features/F01-fundacao`](docs/features/F01-fundacao) |
| F02 Contas & Acesso | [`docs/features/F02-contas`](docs/features/F02-contas) |
| F03 Gateway simulado & Dispatcher | [`docs/features/F03-gateway`](docs/features/F03-gateway) |
| F04 Eventos | [`docs/features/F04-eventos`](docs/features/F04-eventos) |
| F05 Compras & Meus ingressos | [`docs/features/F05-compras`](docs/features/F05-compras) |
| F06 API de parceiros | [`docs/features/F06-api-parceiros`](docs/features/F06-api-parceiros) |
| F07 Check-in & Painel | [`docs/features/F07-checkin-painel`](docs/features/F07-checkin-painel) |
| F08 Cancelamento | [`docs/features/F08-cancelamento`](docs/features/F08-cancelamento) |
