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

A preencher ao longo das waves (a prova de paralelismo é `scripts/check-parallel.sh <pr> <pr>`, que compara as datas dos commits dos PRs):

- W1: F02 — (link do PR, a preencher)
- W1: F03 — (link do PR, a preencher)
- W4: F06 — (link do PR, a preencher)
- W4: F07 — (link do PR, a preencher)

## Decisões

Resumo a partir do [PRD §1](docs/PRD.md); o texto final é completado ao longo das waves.

- **Stack e por quê:** Node.js 22 + TypeScript, Fastify 5 com páginas server-side em EJS (formulários + redirect, sem SPA), PostgreSQL 16 com SQL explícito (`pg`, sem ORM), tudo via Docker Compose. É uma stack pequena, com transações e locks do Postgres à mão (essenciais para R07), testável com `app.inject()` contra um Postgres real e que sobe num clone limpo só com Docker.
- **R07 sob concorrência:** toda operação que lê ou altera vagas ou preço de um evento (compra, edição, publicação, cancelamento) faz `SELECT … FOR UPDATE` na linha do evento dentro de uma transação. As compras do mesmo evento são serializadas no lock e a contagem de vagas (`pending` + `confirmed`) é feita dentro dele, então 30 compras simultâneas para 5 vagas resultam em exatamente 5 × `202` e 25 × `409`.
- **Gateway assíncrono:** a compra grava o ticket `pending` e uma linha em `payments` na mesma transação e, depois do commit, aciona o dispatcher (com polling de 250 ms como rede de segurança). O dispatcher processa cada pagamento concorrentemente e aplica o resultado numa transação com `FOR SHARE` no evento, só se o ticket ainda estiver `pending` e o evento não estiver cancelado.
- **Isolamento da avaliação:** quem implementa não avalia. Cada feature é avaliada por um subagente de contexto vazio, que recebe só o contrato e o commit, e grava um relatório novo e imutável em `docs/features/<feature>/reports/` (um commit por relatório). O estado de cada feature fica em [`state/project-state.json`](state/project-state.json).
