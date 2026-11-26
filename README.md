# Catraca — MVP de venda de ingressos construído em modo agente

A Catraca vende ingressos para eventos pequenos (shows em bar, workshops, meetups): vitrine pública, área do organizador, compra com gateway de pagamento simulado (assíncrono), API de parceiros, check-in na portaria, painel do evento e cancelamento com estorno.

O projeto foi construído com SDD (PRD → spec → plano → contrato) por agentes: um implementador por feature, em branches/worktrees paralelas, e um avaliador independente, de contexto vazio, para cada feature. Porta de entrada dos agentes: [AGENTS.md](AGENTS.md). Enunciado: [docs/brief.md](docs/brief.md).

## Como rodar

**Pré-requisitos:** Docker com **Docker Compose v2** (`docker compose version`), Git e Node.js LTS (só para o `npm run`; não é preciso `npm install`). Nenhum `.env` nem chave de pagamento é necessário.

| Ação | Comando |
|---|---|
| Subir tudo (build + migrações + seed + app) | `npm run up` |
| Derrubar tudo (mantém o volume do banco) | `npm run down` |
| Gates (lint + typecheck + testes, com Postgres efêmero) | `npm run gates` |
| Só alguns testes, via gates | `npm run gates -- test/f01/format.test.ts --reporter=verbose` |
| Fluxo do avaliador (passos 2–16 do enunciado) | `npm run flow` |
| Rajada de concorrência (passo 15) | `scripts/burst.sh [rodadas]` |
| Verificar os artefatos de entrega | `npm run verify:delivery` |

```bash
git clone https://github.com/pizolatoguilherme/mba-desafio-08-catraca.git catraca
cd catraca
npm run up      # só retorna quando o app está healthy; imprime "Catraca no ar: http://localhost:3000"
npm run gates   # roda num projeto Compose separado (<projeto>-gates) e derruba tudo ao final
npm run down
```

O `npm run up` funciona num clone limpo: tudo é construído dentro do Docker (`npm ci` no Dockerfile). O app só fica `healthy` depois de rodar as migrações e a seed (idempotente), e o Postgres não é exposto no host.

**Variáveis** (todas opcionais, com default):

| Variável | Default | Para quê |
|---|---|---|
| `CATRACA_PORT` | `3000` | porta publicada no host |
| `COMPOSE_PROJECT_NAME` | `catraca` | nome do projeto Compose; use um nome único por worktree (ex.: `catraca-f05`) junto com uma porta única (ex.: `CATRACA_PORT=3105`) para rodar ambientes simultâneos |
| `GATEWAY_DELAY_SCALE` | `1` | multiplica os atrasos do gateway simulado; **só** os testes usam valores < 1 |
| `PARTNER_API_KEY` | `catraca-parceiro-2026` | chave aceita no cabeçalho `X-Api-Key` |

`scripts/burst.sh [rodadas]` (default 2 rodadas) cria, em cada rodada, um evento novo publicado com lotação 5 e dispara 30 compras simultâneas pela API (comando do passo 15). Sai com 0 só se todas as rodadas derem exatamente 5 × `202` e 25 × `409`. Aceita `API` e `KEY` no ambiente.

## Endereços

| | Endereço |
|---|---|
| `$WEB` (produto) | `http://localhost:3000` |
| `$API` (API de parceiros) | `http://localhost:3000` (rotas em `/api/partner/...`) |
| Healthcheck | `http://localhost:3000/healthz` |

A porta muda com `CATRACA_PORT` (ex.: `CATRACA_PORT=3101 npm run up` → `http://localhost:3101`).

```bash
export WEB=http://localhost:3000 API=http://localhost:3000 KEY=catraca-parceiro-2026
```

## Credenciais

Contas criadas pela seed (organizadores só existem pela seed):

| Papel | Nome | E-mail | Senha |
|---|---|---|---|
| Organizador A | Organizadora A | `org.a@catraca.dev` | `catraca123` |
| Organizador B | Organizador B | `org.b@catraca.dev` | `catraca123` |
| Participante | Participante Seed | `participante@catraca.dev` | `catraca123` |

Chave de parceiro (cabeçalho `X-Api-Key`): `catraca-parceiro-2026`.

## Mapa dos artefatos

| Artefato | Caminho |
|---|---|
| Enunciado / brief (fonte de verdade das regras R01–R13) | [`docs/brief.md`](docs/brief.md) |
| PRD (features, provê/consome, grafo, waves, critérios) | [`docs/PRD.md`](docs/PRD.md) |
| Arquitetura compartilhada (schema, interfaces, rotas, decisões consolidadas) | [`docs/architecture.md`](docs/architecture.md) |
| Estado do projeto (status e relatório mais recente de cada feature) | [`state/project-state.json`](state/project-state.json) |
| Porta de entrada dos agentes (comandos, regras, mapa) | [`AGENTS.md`](AGENTS.md) |
| Prompts dos agentes (implementador, avaliador, corretor) | [`prompts/`](prompts/) |
| Validação final | [`docs/final-validation/`](docs/final-validation/) |

Features (cada pasta tem `spec.md`, `plan.md`, `contract.md` e `reports/`):

| ID | Feature | Spec | Plano | Contrato | Relatórios |
|---|---|---|---|---|---|
| F01 | Fundação & Harness | [spec](docs/features/F01-fundacao/spec.md) | [plano](docs/features/F01-fundacao/plan.md) | [contrato](docs/features/F01-fundacao/contract.md) | [reports](docs/features/F01-fundacao/reports/) |
| F02 | Contas & Acesso | [spec](docs/features/F02-contas/spec.md) | [plano](docs/features/F02-contas/plan.md) | [contrato](docs/features/F02-contas/contract.md) | [reports](docs/features/F02-contas/reports/) |
| F03 | Gateway simulado & Dispatcher | [spec](docs/features/F03-gateway/spec.md) | [plano](docs/features/F03-gateway/plan.md) | [contrato](docs/features/F03-gateway/contract.md) | [reports](docs/features/F03-gateway/reports/) |
| F04 | Eventos | [spec](docs/features/F04-eventos/spec.md) | [plano](docs/features/F04-eventos/plan.md) | [contrato](docs/features/F04-eventos/contract.md) | [reports](docs/features/F04-eventos/reports/) |
| F05 | Compras & Meus ingressos | [spec](docs/features/F05-compras/spec.md) | [plano](docs/features/F05-compras/plan.md) | [contrato](docs/features/F05-compras/contract.md) | [reports](docs/features/F05-compras/reports/) |
| F06 | API de parceiros | [spec](docs/features/F06-api-parceiros/spec.md) | [plano](docs/features/F06-api-parceiros/plan.md) | [contrato](docs/features/F06-api-parceiros/contract.md) | [reports](docs/features/F06-api-parceiros/reports/) |
| F07 | Check-in & Painel | [spec](docs/features/F07-checkin-painel/spec.md) | [plano](docs/features/F07-checkin-painel/plan.md) | [contrato](docs/features/F07-checkin-painel/contract.md) | [reports](docs/features/F07-checkin-painel/reports/) |
| F08 | Cancelamento | [spec](docs/features/F08-cancelamento/spec.md) | [plano](docs/features/F08-cancelamento/plan.md) | [contrato](docs/features/F08-cancelamento/contract.md) | [reports](docs/features/F08-cancelamento/reports/) |

### PRs das waves paralelas

Duas waves foram executadas em paralelo, cada feature por um agente implementador próprio, numa git worktree própria, com PR próprio. A prova é `scripts/check-parallel.sh <pr> <pr>`, que exige que o primeiro commit de cada PR seja anterior ao último commit do outro (datas `authoredDate` dos commits, em UTC):

| Wave | Feature | PR | Primeiro commit | Último commit |
|---|---|---|---|---|
| W1 | F02 Contas & Acesso | [#2](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/2) | 2026-11-26T11:04:47Z | 2026-11-26T11:20:36Z |
| W1 | F03 Gateway simulado & Dispatcher | [#3](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/3) | 2026-11-26T11:04:56Z | 2026-11-26T11:33:14Z |
| W4 | F06 API de parceiros | [#6](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/6) | 2026-11-26T12:35:57Z | 2026-11-26T17:11:20Z |
| W4 | F07 Check-in & Painel | [#7](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/7) | 2026-11-26T12:36:18Z | 2026-11-26T12:55:01Z |

```bash
scripts/check-parallel.sh 2 3   # OK #2 primeiro < #3 último; OK #3 primeiro < #2 último
scripts/check-parallel.sh 6 7   # OK #6 primeiro < #7 último; OK #7 primeiro < #6 último
```

As waves sequenciais também foram integradas por PR: [#1](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/1) (F01), [#4](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/4) (F04), [#5](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/5) (F05) e [#8](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/8) (F08).

## Decisões

As decisões detalhadas, que prevalecem sobre as specs, estão em [`docs/architecture.md` §8](docs/architecture.md).

- **Stack e por quê:** Node.js 22 + TypeScript, Fastify 5 com páginas server-side em EJS (formulários + redirect, sem SPA), PostgreSQL 16 com SQL explícito (`pg`, sem ORM), tudo via Docker Compose. É uma stack pequena, com transações e locks do Postgres à mão (essenciais para R07), testável com `app.inject()` contra um Postgres real e que sobe num clone limpo só com Docker.
- **R07 sob concorrência:** toda operação que lê ou altera vagas ou preço de um evento (compra, edição, publicação, cancelamento) faz `SELECT … FOR UPDATE` na linha do evento dentro de uma transação. As compras do mesmo evento são serializadas no lock e a contagem de vagas (`pending` + `confirmed`) é feita dentro dele, então 30 compras simultâneas para 5 vagas resultam em exatamente 5 × `202` e 25 × `409`. A vitrine e a API usam a mesma função de compra (`purchaseTicket`), portanto disputam o mesmo lock. Provas: teste de integração com 30 compras simultâneas × 20 rodadas em eventos novos (com um controle negativo sem o lock, que vende demais), e `scripts/burst.sh 10`, que repete o comando literal do passo 15 em 10 eventos novos.
- **Preço e receita:** cada ingresso guarda o preço do momento da compra (`price_cents`); a receita do painel soma só os confirmados, cada um pelo seu preço, e estornados nunca entram como receita.
- **Cancelamento (R11):** numa única transação, com o mesmo lock do evento: o evento vira `cancelled` e um único `UPDATE tickets … CASE` passa confirmados a `refunded` e pendentes a `cancelled`. Edição, publicação e compra passam a ser recusadas; vitrine e API deixam de listar o evento; o check-in responde "Evento cancelado".
- **Gateway assíncrono:** a compra grava o ticket `pending` e uma linha em `payments` na mesma transação e, depois do commit, aciona o dispatcher (com polling de 250 ms como rede de segurança). O dispatcher processa cada pagamento concorrentemente e aplica o resultado numa transação com `FOR SHARE` no evento, só se o ticket ainda estiver `pending` e o evento não estiver cancelado. No modo padrão, os finais 0001, 0002 e "outro" respondem em 2–3 s e os finais 0003/0004 em 30–40 s (todos dentro das faixas do enunciado); `GATEWAY_DELAY_SCALE` reduz os atrasos só nos testes. Assim, uma resposta tardia (ex.: cartão final 0003, 30–40 s) depois do cancelamento não altera nada. A compra responde na hora (`202`/redirect) sem esperar o gateway, e pagamentos que estavam em andamento são retomados se o app reiniciar.
- **Isolamento da avaliação:** quem implementa não avalia. Cada feature é avaliada por um subagente de contexto vazio, que recebe só o contrato e o commit, e grava um relatório novo e imutável em `docs/features/<feature>/reports/` (um commit por relatório). O estado de cada feature fica em [`state/project-state.json`](state/project-state.json).
  - Ferramenta: Claude Code, com subagentes. O implementador roda numa git worktree isolada (`isolation: "worktree"`), com projeto Compose e porta próprios. O avaliador é outro subagente, iniciado sem nenhum contexto do implementador e sem acesso à conversa, que recebe apenas o prompt [`prompts/evaluator.md`](prompts/evaluator.md) preenchido (feature, branch, porta). Ele clona o repositório do GitHub numa pasta nova e avalia o commit `HEAD` da branch.
  - Um FAIL gera correção por um terceiro agente ([`prompts/fixer.md`](prompts/fixer.md)) e uma reavaliação, que produz um relatório novo; relatórios antigos nunca são editados.
  - Integração: cada PR só é mergeado com o relatório mais recente aprovado e o CI (`npm run gates`) verde; depois de cada wave a `main` é validada num clone limpo (`up`, `down`, `up`, `gates`).
  - Validação final: um avaliador independente roda o Fluxo do avaliador completo (passos 1–18) contra a `main` num clone limpo; os relatórios estão em [`docs/final-validation/`](docs/final-validation/) (o mais recente vale).
- **Ajustes pós-entrega** (depois da primeira validação final aprovada, cada um por PR, com CI verde e nova validação final):
  - **Enunciado integral** ([#11](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/11)): [`docs/brief.md`](docs/brief.md) passou a ser a cópia integral do enunciado; regras, mensagens, gateway, API e fluxo já eram idênticos, então nada mais mudou.
  - **F01 — `engines.node >=20`** ([#12](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/12)): o host do avaliador tem "Node.js LTS" sem versão fixa; o produto continua em `node:22-alpine` no container. Não houve reavaliação da F01: o relatório dela atesta o commit avaliado e vários itens do contrato descrevem a `main` da W0 (ex.: a home provisória, depois substituída pela vitrine da F04). A mudança está registrada na [spec da F01](docs/features/F01-fundacao/spec.md) e foi coberta pelos gates e pela validação final.
  - **F03 — faixa rápida do gateway 2–3 s** ([#14](https://github.com/pizolatoguilherme/mba-desafio-08-catraca/pull/14)): os finais 0001/0002/outros passaram de 2–4 s para 2–3 s (dentro dos 2–5 s do enunciado), para ampliar a folga do "confirmado em até 5 segundos" (passos 5 e 8). Contrato emendado antes da reavaliação; novo relatório da F03 aprovado.
  - **F06 — reavaliação na `main` integrada:** o primeiro relatório da F06 foi commitado ~4 h depois do commit avaliado porque a sessão de trabalho ficou pausada durante a avaliação (houve uma única avaliação, sem tentativas descartadas). A F06 foi reavaliada sobre a `main` já com todas as features, gerando um relatório novo; o antigo continua no histórico, intocado.
