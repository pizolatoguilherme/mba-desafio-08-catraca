# Contrato — F02 Contas & Acesso

> Spec: [`spec.md`](spec.md) · Plano: [`plan.md`](plan.md) · Critérios: [`docs/PRD.md`](../../PRD.md) §5 (AC-F02-01…06) e §6 (XC-F02-F01-01).
> Execute os itens **na ordem**. Os testes vitest rodam via gates (`npm run gates -- <arquivo> --reporter=verbose`), sem `npm install` no host. Antes de F04, `/org/events` ainda não existe. Por isso, o acesso à área de organizador é verificado em `GET /org` (criada por F02) e em caminhos `/org/*` quaisquer (protegidos pelo hook global de F02).

## Pré-requisitos de ambiente

- Linux ou macOS com Docker Engine e Docker Compose v2 (≥ 2.20), Git, Node.js 22 LTS, `curl` e shell `bash` (os helpers abaixo e o `diff <(…)` de C-F02-16 usam bash).
- Nenhuma variável do produto exportada: `unset GATEWAY_DELAY_SCALE PARTNER_API_KEY GATEWAY_POLL_MS DATABASE_URL`.
- F01 integrada na `main`, e a branch `feat/F02-contas` derivada dela.
- Variáveis e helpers da avaliação:

  ```bash
  export REPO="$(git rev-parse --show-toplevel)"      # worktree/branch feat/F02-contas
  export SHA="$(git -C "$REPO" rev-parse HEAD)"
  export COMPOSE_PROJECT_NAME=catraca-eval-f02
  export CATRACA_PORT=3202
  export BASE="http://localhost:$CATRACA_PORT"
  export TMPD="$(mktemp -d)"
  export CLONE="$TMPD/catraca-clean"
  sql() { docker compose exec -T db psql -q -U catraca -d catraca -At -c "$1"; }   # rodar de dentro de $CLONE
  # login <email> <senha> <cookie-jar> [next] : imprime status, Location e Set-Cookie (sem \r)
  login() {
    curl -s -o "$TMPD/login.html" -D "$TMPD/login.h" -c "$3" -X POST "$BASE/login" \
      --data-urlencode "email=$1" --data-urlencode "password=$2" --data-urlencode "next=${4-}"
    tr -d '\r' < "$TMPD/login.h" | grep -iE '^(HTTP/|location:|set-cookie:)'
  }
  # signup <nome> <email> <senha> [campo-extra=valor] : idem, para POST /signup
  signup() {
    curl -s -o "$TMPD/signup.html" -D "$TMPD/signup.h" -c "$TMPD/signup.jar" -X POST "$BASE/signup" \
      --data-urlencode "name=$1" --data-urlencode "email=$2" --data-urlencode "password=$3" ${4:+--data-urlencode "$4"}
    tr -d '\r' < "$TMPD/signup.h" | grep -iE '^(HTTP/|location:|set-cookie:)'
  }
  formerr() { grep -o 'data-form-error>[^<]*' "$1"; }
  ```

- Subida a partir de clone limpo, com volume novo:

  ```bash
  (cd "$REPO" && npm run down); docker volume rm "${COMPOSE_PROJECT_NAME}_db-data" 2>/dev/null || true
  git clone --quiet --no-local "$REPO" "$CLONE" && cd "$CLONE" && git checkout --quiet --detach "$SHA"
  npm run up                                 # termina com "Catraca no ar: http://localhost:3202"
  ```

- Seed: `org.a@catraca.dev` (Organizadora A), `org.b@catraca.dev` (Organizador B), `participante@catraca.dev` (Participante Seed), todos com a senha `catraca123`.
- Ao terminar: `cd "$CLONE" && npm run down`.

## Itens verificáveis

### C-F02-01: signup cria participante logado

```bash
cd "$CLONE"
export EMAIL="Nova.$(date +%s)@Example.com"
signup "Nova Pessoa" "$EMAIL" "segredo123"
curl -s -b "$TMPD/signup.jar" "$BASE/" | grep -oE 'data-current-user>[^<]*'
sql "select role || '|' || name || '|' || email from users where email = lower('$EMAIL')"
curl -s "$BASE/signup" | grep -oE '<form[^>]*action="/signup"|name="name"|name="email"|name="password"' | wc -l
```

**Esperado:**
- `HTTP/1.1 303 See Other`, `location: /` e uma linha `set-cookie: sid=…`;
- `data-current-user>Nova Pessoa`;
- `participant|Nova Pessoa|nova.<timestamp>@example.com` (e-mail gravado em minúsculas);
- `4`: o formulário tem os três campos.

### C-F02-02: signup rejeita e-mail duplicado, e-mail mal formado, campos vazios e senha curta

```bash
cd "$CLONE"
N0=$(sql "select count(*) from users")
signup "Outra" "PARTICIPANTE@catraca.dev" "segredo123"; formerr "$TMPD/signup.html"
signup "Outra" "$EMAIL"                    "segredo123"; formerr "$TMPD/signup.html"
signup "Outra" "nao-e-email"               "segredo123"; formerr "$TMPD/signup.html"
signup "   "   "vazio@example.com"         "segredo123"; formerr "$TMPD/signup.html"
signup "Outra" "vazio2@example.com"        "";           formerr "$TMPD/signup.html"
signup "Outra" "curta@example.com"         "abc12";      formerr "$TMPD/signup.html"
N1=$(sql "select count(*) from users"); echo "$N0 $N1"
npm run gates -- test/f02/signup.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:**
- Cada chamada imprime `HTTP/1.1 422 Unprocessable Entity`, **sem** nenhuma linha `set-cookie:`, seguida respectivamente de:
  - `data-form-error>Este e-mail já está cadastrado.` (duas vezes);
  - `data-form-error>Informe um e-mail válido.`;
  - `data-form-error>Preencha nome, e-mail e senha.` (duas vezes);
  - `data-form-error>A senha precisa ter pelo menos 6 caracteres.`.
- `N0` = `N1`: nenhum usuário criado.
- O vitest lista com `✓`, sem nenhum `failed`, e termina com `exit=0`:
  - `signup cria participante logado e redireciona para /`
  - `signup rejeita e-mail já usado (sem diferenciar maiúsculas)`
  - `signup rejeita e-mail mal formado`
  - `signup rejeita campos vazios`
  - `signup rejeita senha com menos de 6 caracteres`
  - `signup respeita next seguro`

### C-F02-03: não existe cadastro de organizador, mesmo com formulário adulterado

```bash
cd "$CLONE"
export EMAIL2="hacker.$(date +%s)@example.com"
signup "Hacker" "$EMAIL2" "segredo123" "role=organizer"
sql "select role from users where email = '$EMAIL2'"
curl -s -o /dev/null -w '%{http_code}\n' -b "$TMPD/signup.jar" "$BASE/org"
sql "select count(*) from users where role = 'organizer'"
npm run gates -- test/f02/signup.test.ts --reporter=verbose -t "role adulterado"; echo "exit=$?"
```

**Esperado:**
- `HTTP/1.1 303 See Other` e `location: /`;
- `participant`;
- `403`;
- `2` (só os organizadores da seed);
- o vitest lista `✓ … signup ignora role adulterado e sempre cria participant`, sem nenhum `failed`, e termina com `exit=0`.

### C-F02-04: login do participante (seed) e destino seguro

```bash
cd "$CLONE"
login participante@catraca.dev catraca123 "$TMPD/p1.jar"
login participante@catraca.dev catraca123 "$TMPD/p2.jar" /me/tickets
login participante@catraca.dev catraca123 "$TMPD/p3.jar" //evil.example.com/x
login participante@catraca.dev catraca123 "$TMPD/p4.jar" https://evil.example.com/
curl -s -b "$TMPD/p1.jar" "$BASE/" | grep -oE 'data-current-user>[^<]*'
curl -s "$BASE/login" | grep -oE '<form[^>]*action="/login"|name="email"|name="password"|name="next"' | wc -l
```

**Esperado:**
- As quatro chamadas imprimem `HTTP/1.1 303 See Other` e uma linha `set-cookie: sid=…`, com `location:` igual a, respectivamente:
  - `/`
  - `/me/tickets`
  - `/` (`next` externo ignorado)
  - `/` (idem)
- `data-current-user>Participante Seed`;
- `4`.

### C-F02-05: login do organizador (seed) vai para a área de organizador

```bash
cd "$CLONE"
login org.a@catraca.dev catraca123 "$TMPD/a.jar"
login org.b@catraca.dev catraca123 "$TMPD/b.jar" /me/tickets
curl -s -b "$TMPD/a.jar" "$BASE/" | grep -oE 'data-current-user>[^<]*'
```

**Esperado:** as duas chamadas imprimem `HTTP/1.1 303 See Other`, `location: /org/events` (o `next` é ignorado para o organizador) e `set-cookie: sid=…`; depois, `data-current-user>Organizadora A`.

### C-F02-06: credenciais erradas são rejeitadas sem criar sessão

```bash
cd "$CLONE"
S0=$(sql "select count(*) from sessions")
login participante@catraca.dev senha-errada "$TMPD/x.jar"; formerr "$TMPD/login.html"
login ninguem@catraca.dev      catraca123   "$TMPD/y.jar"; formerr "$TMPD/login.html"
S1=$(sql "select count(*) from sessions"); echo "$S0 $S1"
npm run gates -- test/f02/login.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:**
- As duas chamadas imprimem `HTTP/1.1 401 Unauthorized`, **sem** linha `set-cookie:`, seguidas de `data-form-error>E-mail ou senha inválidos.`.
- `S0` = `S1`.
- O vitest lista com `✓` os 7 testes de `test/f02/login.test.ts` (nomes em spec §10), sem nenhum `failed`, e termina com `exit=0`.

### C-F02-07: logout (POST e GET) encerra a sessão e invalida o cookie

```bash
cd "$CLONE"
login participante@catraca.dev catraca123 "$TMPD/l.jar" > /dev/null
SID=$(awk '$6=="sid"{print $7}' "$TMPD/l.jar"); sql "select count(*) from sessions where id = '$SID'"
curl -s -D - -o /dev/null -b "$TMPD/l.jar" -X POST "$BASE/logout" | tr -d '\r' | grep -iE '^(HTTP/|location:|set-cookie:)'
sql "select count(*) from sessions where id = '$SID'"
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H "Cookie: sid=$SID" "$BASE/org"
login participante@catraca.dev catraca123 "$TMPD/g.jar" > /dev/null
SID2=$(awk '$6=="sid"{print $7}' "$TMPD/g.jar")
curl -s -D - -o /dev/null -b "$TMPD/g.jar" "$BASE/logout" | tr -d '\r' | grep -iE '^(HTTP/|location:)'
sql "select count(*) from sessions where id = '$SID2'"
```

**Esperado:**
- `1`;
- `HTTP/1.1 303 See Other`, `location: /` e uma linha `set-cookie: sid=;` com `Expires=Thu, 01 Jan 1970 00:00:00 GMT` ou `Max-Age=0`;
- `0`;
- `302 http://localhost:3202/login?next=%2Forg` (o cookie antigo não autentica mais);
- `HTTP/1.1 302 Found` e `location: /`;
- `0`.

### C-F02-08: visitante em qualquer rota `/org` ou `/org/*` é redirecionado para `/login`

```bash
cd "$CLONE"
for p in /org /org/events /org/events/evt_qualquer00 /org/events/new; do
  curl -s -o /dev/null -w "GET $p %{http_code} %{redirect_url}\n" "$BASE$p"; done
curl -s -o /dev/null -w 'POST %{http_code} %{redirect_url}\n' -X POST -d 'name=x' "$BASE/org/events/new"
```

**Esperado:**

```
GET /org 302 http://localhost:3202/login?next=%2Forg
GET /org/events 302 http://localhost:3202/login?next=%2Forg%2Fevents
GET /org/events/evt_qualquer00 302 http://localhost:3202/login?next=%2Forg%2Fevents%2Fevt_qualquer00
GET /org/events/new 302 http://localhost:3202/login?next=%2Forg%2Fevents%2Fnew
POST 302 http://localhost:3202/login?next=%2Forg%2Fevents%2Fnew
```

### C-F02-09: participante em `/org/*` recebe 403 sem nenhum dado de evento

```bash
cd "$CLONE"
sql "insert into events (id, organizer_id, name, venue, starts_at, capacity, price_cents, status, published_at)
     select 'evt_secreto02', id, 'Evento Secreto F02', 'Porão Secreto', now() + interval '7 days', 7, 4321, 'published', now()
     from users where email = 'org.a@catraca.dev'"
login participante@catraca.dev catraca123 "$TMPD/p.jar" > /dev/null
for p in /org /org/events /org/events/evt_secreto02; do
  curl -s -o "$TMPD/403.html" -w "GET $p %{http_code}\n" -b "$TMPD/p.jar" "$BASE$p"
  grep -c 'data-error-status="403"' "$TMPD/403.html"; grep -cE 'Evento Secreto F02|Porão Secreto|43,21' "$TMPD/403.html"; done
curl -s -o "$TMPD/403p.html" -w 'POST %{http_code}\n' -b "$TMPD/p.jar" -X POST -d 'code=ABC' "$BASE/org/events/evt_secreto02/checkin"
grep -cE 'Evento Secreto F02|Porão Secreto|43,21' "$TMPD/403p.html"
sql "delete from events where id = 'evt_secreto02'"
```

**Esperado:** para cada `GET`, a linha `GET <path> 403`, seguida de `1` (página `Acesso negado`) e `0` (nenhum dado do evento); depois, `POST 403` e `0`.

### C-F02-10: organizador acessa a área de organizador

```bash
cd "$CLONE"
login org.b@catraca.dev catraca123 "$TMPD/ob.jar" > /dev/null
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -b "$TMPD/ob.jar" "$BASE/org"
```

**Esperado:** `302 http://localhost:3202/org/events` (não 403 nem redirecionamento para `/login`).

### C-F02-11: guards `requireOrganizer` e `requireParticipant` (testes nomeados)

```bash
cd "$CLONE"; npm run gates -- test/f02/guards.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:** a saída lista com `✓` os testes abaixo, sem nenhum `failed`, e termina com `exit=0`:
- `visitante em /org é redirecionado para /login com next`
- `visitante em qualquer rota /org/* é redirecionado para /login`
- `participante em /org/* recebe 403 sem dados de evento`
- `organizador em /org é redirecionado para /org/events`
- `requireOrganizer não executa o handler quando barra`
- `requireParticipant redireciona visitante para /login com next`
- `requireParticipant responde 403 para organizador`
- `requireParticipant deixa passar participante`

### C-F02-12: senhas guardadas com scrypt + salt, nunca em texto puro

```bash
cd "$CLONE"
sql "select (password_hash ~ '^scrypt\\\$[0-9a-f]{32}\\\$[0-9a-f]{128}\$') || '|' || position('segredo123' in password_hash) from users where email = lower('$EMAIL')"
sql "select count(distinct password_hash) from users where email in ('org.a@catraca.dev','org.b@catraca.dev','participante@catraca.dev')"
npm run gates -- test/f02/password.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:**
- `true|0`: o hash está no formato scrypt e não contém a senha;
- `3`: a mesma senha `catraca123` gera hashes diferentes, porque o salt é aleatório;
- o vitest lista com `✓`, sem nenhum `failed`, e termina com `exit=0`:
  - `verifyPassword aceita a senha correta e recusa a errada`
  - `verifyPassword recusa hash malformado`
  - `senha do signup é gravada com scrypt e nunca em texto puro`

### C-F02-13: cookie de sessão `HttpOnly`, `SameSite=Lax`, `Path=/`, 7 dias

```bash
cd "$CLONE"
curl -s -D - -o /dev/null -X POST "$BASE/login" --data-urlencode email=participante@catraca.dev --data-urlencode password=catraca123 \
  | tr -d '\r' | grep -i '^set-cookie: sid=' > "$TMPD/cookie.txt"; cat "$TMPD/cookie.txt"
for a in 'HttpOnly' 'SameSite=Lax' 'Path=/' 'Max-Age=604800'; do grep -qi -- "$a" "$TMPD/cookie.txt" && echo "ok $a"; done
grep -oE 'sid=[A-Za-z0-9_-]{43};' "$TMPD/cookie.txt" | wc -l
sql "select round(extract(epoch from expires_at - created_at)) from sessions order by created_at desc limit 1"
```

**Esperado:**
- exatamente uma linha `set-cookie: sid=…`;
- `ok HttpOnly`, `ok SameSite=Lax`, `ok Path=/`, `ok Max-Age=604800`;
- `1` (id de 43 caracteres base64url);
- `604800`.

### C-F02-14: o layout mostra o usuário logado e o botão "Sair"

```bash
cd "$CLONE"
curl -s "$BASE/" > "$TMPD/vis.html"
grep -c 'data-nav-login' "$TMPD/vis.html"; grep -c 'data-nav-signup' "$TMPD/vis.html"; grep -c 'data-current-user' "$TMPD/vis.html"
login participante@catraca.dev catraca123 "$TMPD/lay.jar" > /dev/null
curl -s -b "$TMPD/lay.jar" "$BASE/" > "$TMPD/log.html"
grep -oE 'data-current-user>[^<]*' "$TMPD/log.html"; grep -cE '<form[^>]*action="/logout"' "$TMPD/log.html"; grep -c '>Sair<' "$TMPD/log.html"
npm run gates -- test/f02/layout.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:**
- `1`, `1`, `0`;
- `data-current-user>Participante Seed`, `1`, `1`;
- o vitest lista `✓ … layout mostra Entrar e Criar conta para visitante` e `✓ … layout mostra o nome e o botão Sair para usuário logado`, sem nenhum `failed`, e termina com `exit=0`.

### C-F02-15: sessão, `request.user` e helper `loginAs` (testes nomeados)

```bash
cd "$CLONE"; npm run gates -- test/f02/session.test.ts --reporter=verbose; echo "exit=$?"
```

**Esperado:** a saída lista com `✓` os testes abaixo, sem nenhum `failed`, e termina com `exit=0`:
- `request.user é null sem cookie`
- `request.user é preenchido com sessão válida`
- `sessão expirada é ignorada`
- `cookie sid é HttpOnly, SameSite=Lax, Path=/ e dura 7 dias`
- `loginAs devolve o header Cookie de uma sessão válida`

### C-F02-16: contas da seed (F01) entram por `/login` (F02) depois de `npm run up` e depois de `down` + `up` (XC-F02-F01-01)

Produto subido nos pré-requisitos por `npm run up`, a partir de um clone limpo.

```bash
cd "$CLONE"
xc() {
  for u in org.a@catraca.dev org.b@catraca.dev participante@catraca.dev; do
    echo "== $u"; login "$u" catraca123 "$TMPD/xc.jar"
    curl -s -b "$TMPD/xc.jar" "$BASE/" | grep -oE 'data-current-user>[^<]*'
    curl -s -o /dev/null -w '/org %{http_code} %{redirect_url}\n' -b "$TMPD/xc.jar" "$BASE/org"
  done
}
xc > "$TMPD/xc-1.txt"; cat "$TMPD/xc-1.txt"
npm run down && npm run up
xc > "$TMPD/xc-2.txt"; cat "$TMPD/xc-2.txt"
grep -ci '^set-cookie: sid=' "$TMPD/xc-2.txt"
diff <(grep -vi '^set-cookie:' "$TMPD/xc-1.txt") <(grep -vi '^set-cookie:' "$TMPD/xc-2.txt") && echo "iguais após down+up"
```

**Esperado:** em `xc-1.txt`, para cada usuário:

| Usuário | Login (`303` + `set-cookie: sid=…`) | `data-current-user` | `GET /org` |
|---|---|---|---|
| `org.a@catraca.dev` | `location: /org/events` | `Organizadora A` | `/org 302 http://localhost:3202/org/events` |
| `org.b@catraca.dev` | `location: /org/events` | `Organizador B` | `/org 302 http://localhost:3202/org/events` |
| `participante@catraca.dev` | `location: /` (cai na vitrine) | `Participante Seed` | `/org 403` |

Depois de `npm run down && npm run up`, `xc-2.txt` traz a mesma saída, a menos das linhas `set-cookie`. O `grep` imprime `3` (um `set-cookie: sid=…` por login), e a comparação termina com `iguais após down+up`. O `diff <(…)` exige bash.

### C-F02-17: gates completos passam com os testes de F02

```bash
cd "$CLONE"; npm run gates > "$TMPD/gates.log" 2>&1; echo "exit=$?"
grep -oE 'test/f02/[a-z]+\.test\.ts' "$TMPD/gates.log" | sort -u
grep -E 'Test Files' "$TMPD/gates.log"
docker ps -a --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME-gates" -q | wc -l
```

**Esperado:**
- `exit=0`;
- as 6 linhas `test/f02/guards.test.ts`, `test/f02/layout.test.ts`, `test/f02/login.test.ts`, `test/f02/password.test.ts`, `test/f02/session.test.ts` e `test/f02/signup.test.ts`;
- a linha `Test Files` com `passed` e sem `failed`;
- `0`.

## Mapeamento PRD → contrato

- AC-F02-01 → C-F02-01, C-F02-02
- AC-F02-02 → C-F02-04, C-F02-05, C-F02-06, C-F02-07
- AC-F02-03 → C-F02-08, C-F02-09, C-F02-10, C-F02-11
- AC-F02-04 → C-F02-03
- AC-F02-05 → C-F02-11
- AC-F02-06 → C-F02-12, C-F02-13, C-F02-15
- XC-F02-F01-01 → C-F02-16

Os itens C-F02-14 (layout com usuário logado e "Sair", exigido pelo `architecture.md` §5) e C-F02-17 (gates) sustentam todos os critérios acima.

Os demais critérios cross-feature em que F02 é a provedora (arestas para F04, F05 e F07) são cobertos nos contratos das consumidoras, conforme o PRD §6.
