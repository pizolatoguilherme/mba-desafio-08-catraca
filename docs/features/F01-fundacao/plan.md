# Plano — F01 Fundação & Harness

> Spec: [`spec.md`](spec.md) · Contrato: [`contract.md`](contract.md)
> Branch `feat/F01-fundacao`, criada a partir da `main`. Um commit por etapa, no formato `tipo(F01): descrição`, **sem** linhas de coautoria. Push depois de cada etapa.
> Enquanto o gates (etapa 2) não existir, os testes rodam com `npx vitest run` no host, depois do `npm install` da etapa 1 (só o implementador precisa do `npm install`; o produto e os gates não precisam). A partir da etapa 2, use `npm run gates -- <arquivo>`.

## Etapa 1: esqueleto mínimo (commit e push imediatos)

- **Arquivos:**
  - `package.json`: `"name": "catraca"`, `"private": true`, `"type": "module"`, `engines.node >=20`, todos os scripts de spec §4.4 e as dependências de spec §2;
  - `package-lock.json` (gerado por `npm install`);
  - `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `vitest.config.ts` (ainda sem `globalSetup`), `.dockerignore` (`node_modules`, `dist`, `coverage`, `.git`, `.claude`);
  - `src/config.ts` (`Config`, `loadConfig`, `config`).
- **Teste:** `test/f01/config.test.ts` com `loadConfig usa os defaults sem variáveis de ambiente` e `loadConfig lê as variáveis de ambiente`. Rodar `npx vitest run test/f01/config.test.ts`, `npx tsc --noEmit` e `npx eslint .`.
- **Commit:** `chore(F01): esqueleto do projeto (package.json, tsconfig, config)`, e em seguida `git push -u origin feat/F01-fundacao`.

## Etapa 2: Dockerfile e gates isolados

- **Arquivos:**
  - `Dockerfile` (stages `deps`, `build`, `runtime` e `dev`, com `tzdata`; `runtime` ainda com o `CMD` provisório `node dist/server.js`);
  - `compose.gates.yaml` (`testdb` em tmpfs + `gates`, sem portas);
  - `scripts/gates.sh` (modo completo e modo com argumentos, `trap … down -v --remove-orphans`); `chmod +x`.
- **Teste:**
  - `npm run gates` passa (lint, typecheck e o teste de config) e termina com `docker ps -a --filter label=com.docker.compose.project=catraca-gates -q | wc -l` = 0;
  - `npm run gates -- test/f01/config.test.ts --reporter=verbose` também passa.
- **Commit:** `build(F01): Dockerfile multi-stage e gates em compose isolado`.

## Etapa 3: banco, migração com o schema completo

- **Arquivos:**
  - `src/db.ts` (`pool` com max 50, `query`, `withTransaction`, `Db`);
  - `migrations/001_init.sql` (cópia literal de `architecture.md` §3, constraints inline);
  - `src/migrate.ts` (`runMigrations`, `schema_migrations`, advisory lock, execução direta);
  - `test/global-setup.ts` (roda `runMigrations`), `test/setup.ts` (`afterAll(pool.end)`);
  - `vitest.config.ts` (acrescenta `globalSetup`, `setupFiles`, `fileParallelism: false` e os timeouts).
- **Testes:**
  - `test/f01/db.test.ts`: `withTransaction faz COMMIT quando a função resolve`, `withTransaction faz ROLLBACK quando a função lança`, `pool aceita até 50 conexões`;
  - `test/f01/migrate.test.ts`: `runMigrations é idempotente e registra 001_init uma vez`;
  - `test/f01/schema.test.ts`: os 7 testes de C-F01-08, cada um conferindo o código de erro (`23514`/`23505`/`23502`) e o nome da constraint.
  - Rodar `npm run gates -- test/f01/db.test.ts test/f01/migrate.test.ts test/f01/schema.test.ts --reporter=verbose`.
- **Commit:** `feat(F01): pool, withTransaction e migração com o schema completo`.

## Etapa 4: utilitários `ids` e `format`

- **Arquivos:** `src/ids.ts`, `src/format.ts`.
- **Testes:** `test/f01/ids.test.ts` (2 testes de C-F01-16) e `test/f01/format.test.ts` (6 testes de C-F01-15, inclusive a ausência de ` ` e datas inválidas como `2026-02-30T10:00`). Rodar `npm run gates -- test/f01/ids.test.ts test/f01/format.test.ts --reporter=verbose`.
- **Commit:** `feat(F01): geradores de id/código e formatação (BRL, datas, status)`.

## Etapa 5: `hashPassword` e seed idempotente

- **Arquivos:**
  - `src/auth/password.ts` (só `hashPassword`, com os parâmetros de D11);
  - `src/seed.ts` (`SEED_USERS`, `runSeed`, upsert por `lower(email)`, execução direta).
- **Testes:**
  - `test/f01/password.test.ts`: `hashPassword gera scrypt$salt$hash com salt aleatório`;
  - `test/f01/seed.test.ts`: `runSeed cria 2 organizadores e 1 participante`, `runSeed é idempotente (3 execuções)`, `senhas da seed ficam com hash scrypt`.
- **Commit:** `feat(F01): hashPassword (scrypt) e seed idempotente`.

## Etapa 6: helpers de teste

- **Arquivos:** `test/helpers.ts` (`resetDb`, `createUser`, `createEvent`, `insertTicket`, com os defaults de spec §4.1).
- **Testes:** `test/f01/helpers.test.ts`, com os 4 testes de C-F01-19.
- **Commit:** `test(F01): helpers resetDb, createUser, createEvent e insertTicket`.

## Etapa 7: servidor, views e registro de features

- **Arquivos:**
  - `src/features.ts` (`featurePlugins = []`);
  - `src/server.ts`:
    - `buildApp`: core, `/healthz`, 404/500, `featurePlugins` e fallback de `GET /` via `hasRoute`;
    - execução direta: `listen` em `0.0.0.0` e shutdown em `SIGTERM`/`SIGINT`;
  - `src/views/layout.ejs`, `src/views/home.ejs`, `src/views/error.ejs`.
- **Testes:** `test/f01/http.test.ts`, com os 5 testes de C-F01-20. Os testes de `featurePlugins` empurram plugins de teste no array e o restauram em `afterEach`.
- **Commit:** `feat(F01): buildApp com healthz, layout, home placeholder e páginas de erro`.

## Etapa 8: produto em Compose (`up`/`down`)

- **Arquivos:**
  - `compose.yaml` (spec §4.4);
  - `Dockerfile` (`CMD` final do `runtime`: `migrate && seed && exec server`);
  - `scripts/up.sh`, `scripts/down.sh` (`chmod +x`).
- **Teste:** fumaça manual dos itens C-F01-01 a C-F01-07 e C-F01-11 a C-F01-13 com `COMPOSE_PROJECT_NAME=catraca-f01 CATRACA_PORT=3101`. Conferir que `npm run up` só retorna com `healthy` e que `npm run down` não deixa containers.
- **Commit:** `build(F01): compose do produto com healthcheck, scripts up/down`.

## Etapa 9: scripts `burst.sh` e `check-parallel.sh`

- **Arquivos:** `scripts/burst.sh` e `scripts/check-parallel.sh` (POSIX `sh`, `chmod +x`, comportamento de spec §4.4).
- **Testes:** `test/f01/scripts.test.ts`, com os 5 testes de C-F01-21:
  - `sh -n` e o bit executável dos 5 scripts;
  - `burst.sh --help` com saída 0;
  - `check-parallel.sh` com um `gh` falso no `PATH`: sobreposto → 0, sequencial → 1, 1 PR → 2.
- **Commit:** `feat(F01): scripts de rajada (passo 15) e de prova de paralelismo`.

## Etapa 10: CI

- **Arquivos:** `.github/workflows/gates.yml` (`pull_request` + `push` na `main`, job `gates` com `npm run gates`).
- **Teste:** depois do push, `gh run list --branch feat/F01-fundacao --limit 1` mostra a execução. Ela é conferida de novo no PR (etapa 12).
- **Commit:** `ci(F01): workflow de gates em PR e push`.

## Etapa 11: README

- **Arquivos:** `README.md` reescrito com as 5 seções de spec §4.6. Credenciais, chave, endereços e comandos ficam preenchidos; os links dos PRs ficam como marcadores para a Fase 9.
- **Teste:** os comandos de C-F01-24 imprimem 12 `ok` e as 5 seções na ordem. `node scripts/check-artifacts.mjs --readme` pode falhar **só** no item "README lista links de PRs".
- **Commit:** `docs(F01): README com como rodar, endereços, credenciais, mapa e decisões`.

## Etapa 12: fumaça do contrato, gates, estado e PR

1. Rodar, como fumaça, todos os itens de `contract.md` (C-F01-01 a C-F01-24 e C-F01-26) num clone limpo, com `COMPOSE_PROJECT_NAME=catraca-f01 CATRACA_PORT=3101`. Ao final, `npm run down`.
2. `npm run gates` → saída 0.
3. Atualizar `state/project-state.json` **só** na entrada `F01`: `"status": "implemented"`, `"branch": "feat/F01-fundacao"` e `"pr"` com o número/URL depois de criar o PR. Atualizar também `updatedAt`.
4. Commit `chore(F01): estado implemented` e push.
5. `gh pr create --base main --head feat/F01-fundacao --title "F01: Fundação & Harness" --body "<resumo, itens do contrato atendidos, como testar>"`.
6. Conferir `gh pr checks` com o job `gates` em `pass` (C-F01-22). Se o número do PR entrar no estado depois da criação, fazer um commit `chore(F01): registra PR no estado` e push.
