# Contrato — F01 Fundação & Harness

> Spec: [`spec.md`](spec.md) · Plano: [`plan.md`](plan.md) · Critérios: [`docs/PRD.md`](../../PRD.md) §5 (AC-F01-01…10).
> Execute os itens **na ordem**: alguns usam o estado deixado pelo item anterior (produto no ar, arquivos em `$TMPD`). Os testes vitest são executados **via gates** (`npm run gates -- <arquivo> --reporter=verbose`), sem `npm install` no host.

## Pré-requisitos de ambiente

- Linux ou macOS com Docker Engine e **Docker Compose v2** (`docker compose version` ≥ 2.20), Git, Node.js LTS (≥ 20; o produto roda em `node:22-alpine` no container), `curl` e shell `bash` para executar os comandos abaixo. `gh` autenticado só para C-F01-22.
- Nenhuma variável do produto exportada no shell: `unset GATEWAY_DELAY_SCALE PARTNER_API_KEY GATEWAY_POLL_MS DATABASE_URL`.
- Variáveis da avaliação (ambiente isolado; os valores podem mudar, desde que sejam únicos na máquina):

  ```bash
  export REPO="$(git rev-parse --show-toplevel)"      # worktree/branch feat/F01-fundacao
  export SHA="$(git -C "$REPO" rev-parse HEAD)"
  export COMPOSE_PROJECT_NAME=catraca-eval-f01
  export CATRACA_PORT=3201
  export BASE="http://localhost:$CATRACA_PORT"
  export TMPD="$(mktemp -d)"
  export CLONE="$TMPD/catraca-clean"
  sql() { docker compose exec -T db psql -U catraca -d catraca -At -c "$1"; }   # rodar de dentro de $CLONE
  ```

- Estado inicial: nenhum container nem volume desse projeto.

  ```bash
  (cd "$REPO" && npm run down)
  docker volume rm "${COMPOSE_PROJECT_NAME}_db-data" 2>/dev/null || true
  docker ps -a --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" -q | wc -l   # → 0
  ```

- Ao terminar a avaliação: `cd "$CLONE" && npm run down`.
- Seed esperada: `org.a@catraca.dev`, `org.b@catraca.dev` e `participante@catraca.dev`, todos com a senha `catraca123`. Chave de parceiro: `catraca-parceiro-2026`.

## Itens verificáveis

### C-F01-01: `npm run up` sobe tudo a partir de um clone limpo, sem `npm install`

```bash
git clone --quiet --no-local "$REPO" "$CLONE" && cd "$CLONE" && git checkout --quiet --detach "$SHA"
test ! -e node_modules && echo "sem node_modules"
npm run up; echo "exit=$?"
curl -s -w ' %{http_code}\n' "$BASE/healthz"     # imediatamente, sem sleep nem retry
```

**Esperado:** `sem node_modules`; a subida constrói as imagens e termina com `exit=0` e uma linha `Catraca no ar: http://localhost:3201`; o `curl` imprime exatamente `{"ok":true} 200`.

### C-F01-02: a subida só retorna com o app saudável e a seed carregada

```bash
cd "$CLONE"
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q app)"
sql "select email || ' ' || role from users order by email"
grep -c -- '--wait' scripts/up.sh
```

**Esperado:** `healthy`; exatamente três linhas: `org.a@catraca.dev organizer`, `org.b@catraca.dev organizer`, `participante@catraca.dev participant`; o `grep` imprime um número ≥ 1.

### C-F01-03: só a porta do produto é publicada; o Postgres não fica exposto

```bash
docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
  --format '{{.Label "com.docker.compose.service"}}|{{.Ports}}' | sort
```

**Esperado:** exatamente duas linhas. A linha `app|…` contém `0.0.0.0:3201->3000/tcp` (pode haver também `[::]:3201->3000/tcp`). A linha `db|5432/tcp` **não** contém `->`.

### C-F01-04: fuso e defaults do modo padrão dentro dos containers

```bash
cd "$CLONE"
docker compose exec -T app sh -c 'echo "$TZ|$GATEWAY_DELAY_SCALE|$PARTNER_API_KEY|$GATEWAY_POLL_MS"'
docker compose exec -T app node -e "console.log(new Date('2026-12-05T12:00:00Z').getTimezoneOffset())"
sql "show timezone"
```

**Esperado:** `America/Sao_Paulo|1|catraca-parceiro-2026|250`; `180`; `America/Sao_Paulo`.

### C-F01-05: nenhum `.env` nem chave de pagamento é necessário

```bash
cd "$CLONE"
git ls-files | grep -E '(^|/)\.env'; echo "grep_env=$?"
grep -nE 'env_file' compose.yaml compose.gates.yaml; echo "grep_env_file=$?"
npm run gates -- test/f01/config.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:** `grep_env=1` (nenhum arquivo `.env` versionado); `grep_env_file=1`. A saída do vitest lista com `✓` os testes `loadConfig usa os defaults sem variáveis de ambiente` e `loadConfig lê as variáveis de ambiente`, sem nenhum `failed`, e termina com `exit=0`. A própria subida de C-F01-01 foi feita sem exportar nenhuma variável do produto.

### C-F01-06: `/healthz`, layout, placeholder da home e 404 genérico

```bash
curl -s -i "$BASE/healthz" | tr -d '\r' | grep -iE '^HTTP/|^content-type:|^\{'
curl -s -o "$TMPD/home.html" -w '%{http_code}\n' "$BASE/"
grep -c '<html lang="pt-BR">' "$TMPD/home.html"; grep -c 'data-page="home"' "$TMPD/home.html"
curl -s -o "$TMPD/404.html" -w '%{http_code}\n' "$BASE/rota-que-nao-existe"
grep -c 'data-error-status="404"' "$TMPD/404.html"; grep -c 'Página não encontrada' "$TMPD/404.html"
```

**Esperado:** `HTTP/1.1 200 OK`, `content-type: application/json; charset=utf-8` e o corpo `{"ok":true}`; `200`, `1`, `1`; `404`, `1`, `1`.

### C-F01-07: migrações idempotentes e schema completo

```bash
cd "$CLONE"
docker compose exec -T app node dist/migrate.js; echo "migrate=$?"
sql "select version from schema_migrations order by version"
sql "select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema = 'public'"
```

**Esperado:** `migrate=0`; uma única linha `001_init`; `events,payments,schema_migrations,sessions,tickets,users`.

### C-F01-08: o schema impõe as invariantes (banco do produto + testes)

```bash
cd "$CLONE"
docker compose exec -T db psql -U catraca -d catraca -v ON_ERROR_STOP=0 <<'SQL' 2>&1 | grep -E 'ERROR|^ ?pending'
BEGIN;
INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents)
  SELECT 'evt_contrato00', id, 'Contrato', 'Local', now() + interval '7 days', 5, 1000 FROM users WHERE email = 'org.a@catraca.dev';
INSERT INTO tickets (id, event_id, buyer_email, channel, code, price_cents, card_last4)
  VALUES ('tkt_contrato00', 'evt_contrato00', 'a@example.com', 'partner', 'CTRT2345', 1000, '0001');
SAVEPOINT s;
UPDATE events SET capacity = 0 WHERE id = 'evt_contrato00';
ROLLBACK TO s;
UPDATE events SET price_cents = 0 WHERE id = 'evt_contrato00';
ROLLBACK TO s;
UPDATE events SET status = 'archived' WHERE id = 'evt_contrato00';
ROLLBACK TO s;
INSERT INTO tickets (id, event_id, buyer_email, channel, code, price_cents, card_last4)
  VALUES ('tkt_contrato01', 'evt_contrato00', 'b@example.com', 'partner', 'CTRT2345', 1000, '0001');
ROLLBACK TO s;
UPDATE tickets SET status = 'used' WHERE id = 'tkt_contrato00';
ROLLBACK TO s;
UPDATE tickets SET price_cents = 0 WHERE id = 'tkt_contrato00';
ROLLBACK TO s;
INSERT INTO tickets (id, event_id, buyer_email, channel, code, card_last4)
  VALUES ('tkt_contrato02', 'evt_contrato00', 'c@example.com', 'partner', 'CTRT2346', '0001');
ROLLBACK TO s;
SELECT status || ' ' || price_cents FROM tickets WHERE id = 'tkt_contrato00';
ROLLBACK;
SQL
sql "select count(*) from events where id = 'evt_contrato00'"
npm run gates -- test/f01/schema.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:**

1. Sete linhas `ERROR`, nesta ordem, citando respectivamente: `events_capacity_check`, `events_price_cents_check`, `events_status_check`, `duplicate key value violates unique constraint "tickets_code_key"`, `tickets_status_check`, `tickets_price_cents_check` e `null value in column "price_cents"`.
2. A linha `pending 1000` (o status default do ingresso é `pending`).
3. `0` (nada persistiu).
4. O vitest lista com `✓`, sem nenhum `failed`, e termina com `exit=0`:
   - `rejeita events.capacity menor que 1`
   - `rejeita events.price_cents menor ou igual a 0`
   - `rejeita events.status fora de draft/published/cancelled`
   - `rejeita tickets.code duplicado`
   - `rejeita tickets.status fora dos cinco valores`
   - `exige tickets.price_cents positivo por ingresso`
   - `users.email é único sem diferenciar maiúsculas`

### C-F01-09: `npm run gates` roda lint, typecheck e testes, passa e não deixa nada rodando

Com o produto de C-F01-01 ainda no ar:

```bash
cd "$CLONE"
docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" | sort > "$TMPD/antes.txt"
npm run gates > "$TMPD/gates.log" 2>&1; echo "exit=$?"
grep -cE '> (eslint \.|tsc --noEmit|vitest run)$' "$TMPD/gates.log"
grep -E 'Test Files' "$TMPD/gates.log"
docker ps -a  --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME-gates" -q | wc -l
docker volume ls  --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME-gates" -q | wc -l
docker network ls --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME-gates" -q | wc -l
```

**Esperado:**
- `exit=0`;
- o primeiro `grep` imprime `3`: lint, typecheck e testes foram executados;
- a linha `Test Files` mostra `N passed` com N ≥ 11 e nenhum `failed`;
- os três contadores finais imprimem `0`, `0`, `0`.

### C-F01-10: os gates rodam num clone limpo sem `npm install` e não interferem no produto no ar

Usa os arquivos gerados em C-F01-09. O `$CLONE` nunca recebeu `npm install`.

```bash
cd "$CLONE"
test ! -e node_modules && echo "sem node_modules"
docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" | sort > "$TMPD/depois.txt"
diff "$TMPD/antes.txt" "$TMPD/depois.txt" && echo "produto intacto"
wc -l < "$TMPD/depois.txt"
curl -s "$BASE/healthz"
```

**Esperado:** `sem node_modules`; `produto intacto` (os mesmos IDs de container antes e depois dos gates); `2`; `{"ok":true}`.

### C-F01-11: `npm run down` encerra tudo o que a subida iniciou

```bash
cd "$CLONE"
npm run down; echo "exit=$?"
docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" -q | wc -l
docker ps --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME-gates" -q | wc -l
curl -s -m 3 -o /dev/null -w '%{http_code}\n' "$BASE/healthz"; echo "curl=$?"
docker volume ls -q --filter "name=${COMPOSE_PROJECT_NAME}_db-data"
```

**Esperado:**
- `exit=0`;
- `0` e `0`;
- `000` e `curl=7` (conexão recusada; qualquer código ≠ 0 com `000` também vale);
- o volume `catraca-eval-f01_db-data` continua listado: o `down` mantém os dados.

### C-F01-12: up → down → up funciona, e a seed é reexecutável

```bash
cd "$CLONE"
npm run up; echo "up=$?"
curl -s "$BASE/healthz"; echo
docker compose exec -T app node dist/seed.js; echo "seed1=$?"
docker compose exec -T app node dist/seed.js; echo "seed2=$?"
sql "select role || ' ' || count(*) from users where email in ('org.a@catraca.dev','org.b@catraca.dev','participante@catraca.dev') group by role order by role"
sql "select count(*) from users"
npm run gates -- test/f01/seed.test.ts test/f01/migrate.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:**
- `up=0`, `{"ok":true}`, `seed1=0`, `seed2=0`;
- as linhas `organizer 2` e `participant 1`, e depois `3`;
- o vitest lista com `✓`, sem nenhum `failed`, e termina com `exit=0`:
  - `runSeed cria 2 organizadores e 1 participante`
  - `runSeed é idempotente (3 execuções)`
  - `senhas da seed ficam com hash scrypt`
  - `runMigrations é idempotente e registra 001_init uma vez`

### C-F01-13: dois ambientes simultâneos com `COMPOSE_PROJECT_NAME`/`CATRACA_PORT` diferentes

```bash
cd "$CLONE"
COMPOSE_PROJECT_NAME=catraca-par1 CATRACA_PORT=3311 npm run up; echo "up1=$?"
COMPOSE_PROJECT_NAME=catraca-par2 CATRACA_PORT=3312 npm run up; echo "up2=$?"
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3311/healthz
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3312/healthz
docker ps --filter label=com.docker.compose.project=catraca-par1 -q | wc -l
docker ps --filter label=com.docker.compose.project=catraca-par2 -q | wc -l
COMPOSE_PROJECT_NAME=catraca-par1 npm run down
curl -s -m 3 -o /dev/null -w '%{http_code}\n' http://localhost:3311/healthz
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3312/healthz
COMPOSE_PROJECT_NAME=catraca-par2 npm run down
docker volume rm catraca-par1_db-data catraca-par2_db-data >/dev/null
```

**Esperado:**
- `up1=0` e `up2=0`;
- `200` e `200`;
- `2` e `2`;
- depois de derrubar `par1`: `000` na porta 3311 e `200` na 3312 (derrubar um ambiente não afeta o outro);
- o ambiente `catraca-eval-f01` (C-F01-12) continua no ar.

### C-F01-14: estrutura do harness (scripts npm, Dockerfile e Compose)

```bash
cd "$CLONE"
node -e "const s=require('./package.json').scripts;for(const k of ['up','down','gates','gates:inner','lint','typecheck','test','build','flow','verify:delivery'])console.log(k+' => '+s[k])"
grep -E '^FROM [^ ]+ AS (deps|build|runtime|dev)$' Dockerfile | awk '{print $4}'
docker compose config --format json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const c=JSON.parse(d),a=c.services.app,b=c.services.db;console.log("app.healthcheck="+Boolean(a.healthcheck),"db.healthcheck="+Boolean(b.healthcheck),"db.ports="+JSON.stringify(b.ports||[]),"app.target="+a.build.target,"app.TZ="+a.environment.TZ,"db.TZ="+b.environment.TZ,"app.port="+a.ports[0].published+"->"+a.ports[0].target)})'
docker compose -p "$COMPOSE_PROJECT_NAME-gates" -f compose.gates.yaml config --format json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const c=JSON.parse(d),b=c.services.testdb,g=c.services.gates;console.log("testdb.tmpfs="+JSON.stringify(b.tmpfs),"gates.target="+g.build.target,"ports="+JSON.stringify([b.ports||[],g.ports||[]]))})'
```

**Esperado:**

```
up => sh scripts/up.sh
down => sh scripts/down.sh
gates => sh scripts/gates.sh
gates:inner => npm run lint && npm run typecheck && npm run test
lint => eslint .
typecheck => tsc --noEmit
test => vitest run
build => tsc -p tsconfig.build.json
flow => node scripts/flow/evaluator-flow.mjs
verify:delivery => node scripts/check-artifacts.mjs --all
deps
build
runtime
dev
app.healthcheck=true db.healthcheck=true db.ports=[] app.target=runtime app.TZ=America/Sao_Paulo db.TZ=America/Sao_Paulo app.port=3201->3000
testdb.tmpfs=["/var/lib/postgresql/data"] gates.target=dev ports=[[],[]]
```

### C-F01-15: `src/format.ts` (testes nomeados)

```bash
cd "$CLONE"; npm run gates -- test/f01/format.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:** a saída lista com `✓` os testes abaixo, sem nenhum `failed`, e termina com `exit=0`:
- `formatBRL usa espaço comum e vírgula decimal`: 35000 → `R$ 350,00`, 0 → `R$ 0,00`, 123456 → `R$ 1.234,56`, sem U+00A0;
- `toIsoWithOffset devolve ISO com offset -03:00`: `2026-12-06T00:00:00Z` → `2026-12-05T21:00:00-03:00`;
- `parseLocalDateTime interpreta datetime-local em America/Sao_Paulo`: `2026-12-05T21:00` → `2026-12-06T00:00:00.000Z`; `2026-02-30T10:00` e `abc` → `null`;
- `parsePriceToCents aceita vírgula, ponto e inteiro`: `100,00`, `100.00`, `100` e `R$ 100,00` → 10000; ` 150,5 ` → 15050;
- `parsePriceToCents rejeita entradas inválidas`: `''`, `abc`, `-1`, `1.234,56`, `10,999` → `null`;
- `statusLabel traduz os cinco status`.

### C-F01-16: `src/ids.ts` (testes nomeados)

```bash
cd "$CLONE"; npm run gates -- test/f01/ids.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:** `✓` nos testes abaixo, sem nenhum `failed`, e `exit=0`:
- `newId gera prefixo e 10 caracteres [a-z0-9]`: regex `^(usr|evt|tkt)_[a-z0-9]{10}$`, 1 000 ids distintos;
- `newTicketCode gera 8 caracteres [A-Z2-9] sem 0, 1, O e I`: regex `^[A-HJ-NP-Z2-9]{8}$` em 10 000 amostras.

### C-F01-17: `hashPassword` e as senhas da seed

Com o produto de C-F01-12 no ar:

```bash
cd "$CLONE"
npm run gates -- test/f01/password.test.ts --reporter=verbose; echo "exit=$?"
sql "select email || ' ' || (password_hash ~ '^scrypt\\\$[0-9a-f]{32}\\\$[0-9a-f]{128}\$') from users order by email"
docker compose exec -T app node --input-type=module -e '
import { scryptSync, timingSafeEqual } from "node:crypto"; import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const r = await c.query("select email, password_hash from users order by email");
for (const u of r.rows) { const [, s, h] = u.password_hash.split("$");
  console.log(u.email, timingSafeEqual(scryptSync("catraca123", Buffer.from(s, "hex"), 64), Buffer.from(h, "hex"))); }
await c.end();'
```

**Esperado:**
- o vitest lista `✓ hashPassword gera scrypt$salt$hash com salt aleatório` (dois hashes da mesma senha diferem), sem nenhum `failed`, e termina com `exit=0`;
- o SQL mostra três linhas terminadas em ` true`;
- o node mostra três linhas terminadas em ` true`: as credenciais documentadas batem com o banco.

### C-F01-18: `src/db.ts` (testes nomeados)

```bash
cd "$CLONE"; npm run gates -- test/f01/db.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:** `✓` nos testes abaixo, sem nenhum `failed`, e `exit=0`:
- `withTransaction faz COMMIT quando a função resolve`;
- `withTransaction faz ROLLBACK quando a função lança`;
- `pool aceita até 50 conexões` (`pool.options.max === 50`).

### C-F01-19: helpers de teste (`test/helpers.ts`)

```bash
cd "$CLONE"; npm run gates -- test/f01/helpers.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:** `✓` nos testes abaixo, sem nenhum `failed`, e `exit=0`:
- `resetDb limpa as tabelas e recarrega a seed`;
- `createUser grava usuário com hash e devolve a senha em texto`;
- `createEvent aplica os defaults e respeita o status`;
- `insertTicket usa o preço do evento e gera código`.

### C-F01-20: `buildApp`, `featurePlugins` e rotas do core (testes nomeados)

```bash
cd "$CLONE"; npm run gates -- test/f01/http.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:** `✓` nos testes abaixo, sem nenhum `failed`, e `exit=0`:
- `GET /healthz responde 200 com {ok:true}`;
- `GET / renderiza o placeholder dentro do layout`;
- `rota inexistente responde 404 com error.ejs`;
- `buildApp registra featurePlugins em ordem`;
- `placeholder de GET / não é registrado se uma feature já registrou GET /`.

### C-F01-21: scripts `burst.sh` e `check-parallel.sh`

```bash
cd "$CLONE"
for f in up down gates burst check-parallel; do test -x "scripts/$f.sh" && sh -n "scripts/$f.sh" && echo "ok $f"; done
scripts/burst.sh --help; echo "help=$?"
grep -c 'xargs -P 30' scripts/burst.sh
grep -c 'docker compose exec -T db psql' scripts/burst.sh
scripts/check-parallel.sh; echo "uso=$?"
npm run gates -- test/f01/scripts.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:**
- `ok up`, `ok down`, `ok gates`, `ok burst`, `ok check-parallel`;
- uma linha começando com `Uso: scripts/burst.sh [rodadas]` e `help=0`;
- os dois `grep` imprimem números ≥ 1;
- `Uso: scripts/check-parallel.sh <pr> <pr> [...]` e `uso=2`;
- o vitest lista com `✓`, sem nenhum `failed`, e termina com `exit=0`:
  - `scripts do harness existem e são executáveis`
  - `burst.sh --help mostra o uso`
  - `check-parallel aprova PRs com commits sobrepostos`
  - `check-parallel reprova PRs sequenciais`
  - `check-parallel exige pelo menos 2 PRs`

A execução real do `burst.sh` (5×202/25×409) depende de F06 e é verificada no contrato de F06 e na validação final.

### C-F01-22: CI roda `npm run gates` em PR e push, e passa no PR de F01

```bash
cd "$REPO"
grep -nE 'pull_request|push:|npm run gates' .github/workflows/gates.yml
gh pr checks "$(gh pr view feat/F01-fundacao --json number -q .number)"
```

**Esperado:** o `grep` mostra as linhas de `pull_request`, `push:` e `npm run gates`, e o `gh pr checks` mostra o job `gates` com estado `pass`.

### C-F01-23: `AGENTS.md` na raiz com comandos, regras e mapa; `CLAUDE.md` aponta para ele

```bash
cd "$CLONE"
for s in 'npm run up' 'npm run down' 'npm run gates'; do grep -qF "$s" AGENTS.md && echo "ok $s"; done
grep -cE '^## Regras' AGENTS.md; grep -cE '^## Mapa dos artefatos' AGENTS.md
grep -c 'AGENTS.md' CLAUDE.md
```

**Esperado:** `ok npm run up`, `ok npm run down`, `ok npm run gates`; `1`, `1`; um número ≥ 1.

### C-F01-24: README com a estrutura do Entregável e os dados já conhecidos

```bash
cd "$CLONE"
grep -E '^## ' README.md
for s in 'org.a@catraca.dev' 'org.b@catraca.dev' 'participante@catraca.dev' 'catraca123' 'catraca-parceiro-2026' \
         'http://localhost:3000' 'npm run up' 'npm run down' 'npm run gates' 'docs/PRD.md' 'state/project-state.json' 'AGENTS.md'; do
  grep -qF "$s" README.md && echo "ok $s" || echo "FALTA $s"; done
```

**Esperado:**
- o primeiro comando lista, nesta ordem, `## Como rodar`, `## Endereços`, `## Credenciais`, `## Mapa dos artefatos` e `## Decisões` (outras seções `##` podem existir entre elas);
- 12 linhas `ok …` e nenhuma `FALTA`;
- o funcionamento das credenciais no produto é coberto por C-F01-17, neste contrato, e pelo login real em XC-F02-F01-01.

### C-F01-26: arquivo de estado bem formado, com F01 atualizada

```bash
cd "$REPO"
node -e '
const fs=require("fs");const s=JSON.parse(fs.readFileSync("state/project-state.json","utf8"));
const ids=Object.keys(s.features);console.log(ids.join(","));
for(const id of ids){const f=s.features[id];
  if(s.statusLegend.includes(f.status)===false) throw new Error(id+": status inválido");
  if(("latestReport" in f)===false) throw new Error(id+": sem latestReport");
  if(f.latestReport && fs.existsSync(f.latestReport)===false) throw new Error(id+": caminho inexistente");}
console.log("F01="+s.features.F01.status+" branch="+s.features.F01.branch);'
```

**Esperado:** `F01,F02,F03,F04,F05,F06,F07,F08`; `F01=implemented branch=feat/F01-fundacao` (ou `evaluating`, se o orquestrador já tiver atualizado o estado para a avaliação); nenhuma exceção.

> **Completude final do README e do estado.** Os links dos PRs das waves paralelas e todas as features `done` com relatório só existem no fim do projeto. Por isso não são itens deste contrato: são verificados na validação final (Fase 9) por `npm run verify:delivery` (`scripts/check-artifacts.mjs --all`), fora do veredito de F01. Todo item deste contrato é verificável no momento da avaliação de F01.

## Mapeamento PRD → contrato

- AC-F01-01 → C-F01-01, C-F01-02, C-F01-04, C-F01-06, C-F01-14
- AC-F01-02 → C-F01-03, C-F01-11
- AC-F01-03 → C-F01-07, C-F01-12, C-F01-17
- AC-F01-04 → C-F01-09, C-F01-10, C-F01-22
- AC-F01-05 → C-F01-04, C-F01-05
- AC-F01-06 → C-F01-08
- AC-F01-07 → C-F01-23
- AC-F01-08 → C-F01-13
- AC-F01-09 → C-F01-24
- AC-F01-10 → C-F01-26

Os itens C-F01-15 a C-F01-21 verificam as interfaces que F01 provê às outras features (`architecture.md` §5: `format`, `ids`, `password`, `db`, helpers de teste, `buildApp`/`featurePlugins`) e os scripts do harness. Eles também sustentam AC-F01-04, porque são os testes automatizados que o gates executa.

Critérios cross-feature: nenhum é coberto por F01. Os das arestas que saem de F01 (para F02, F03 e F04) são cobertos nos contratos das consumidoras, conforme o PRD §6.
