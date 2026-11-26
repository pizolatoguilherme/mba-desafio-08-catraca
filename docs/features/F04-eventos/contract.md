# Contrato — F04 Eventos

Contrato verificado pelo avaliador independente. Cada item diz **como verificar** e o **resultado esperado**. Um item só passa se o resultado observado for exatamente o esperado. Referência: [`spec.md`](spec.md).

## Pré-requisitos de ambiente

1. Máquina com Linux/macOS, Docker (Compose v2), Git, Node.js LTS e shell `bash`. Nenhum `npm install` no host.
2. Worktree na branch `feat/F04-eventos`, no commit avaliado (`git rev-parse HEAD`). A `main` contém F01, F02 e F03 `done`.
3. Ambiente isolado, banco limpo e seed (org A `org.a@catraca.dev`, org B `org.b@catraca.dev`, participante `participante@catraca.dev`, todos com a senha `catraca123`). Rode na raiz da worktree:

```bash
export COMPOSE_PROJECT_NAME=catraca-f04 CATRACA_PORT=3104
docker compose down -v --remove-orphans; npm run up     # volume novo: nenhum evento pré-existente
WEB="http://localhost:$CATRACA_PORT"
J=$(mktemp -d); touch "$J/V.jar"                         # V = visitante (jar vazio)

sql()  { docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<<"$1"; }
# Teste vitest nomeado via gates (F01 D6: `npm run gates -- <args>`; Postgres efêmero; derruba o projeto -gates ao final)
vt() { npm run gates -- "$1" -t "$2" --reporter=verbose; }

# login <jar> <email>  → imprime "<status> <destino>"
login() { curl -s -c "$J/$1.jar" -b "$J/$1.jar" -o /dev/null -w '%{http_code} %{redirect_url}\n' --data-urlencode "email=$2" --data-urlencode "password=catraca123" "$WEB/login"; }
# get <jar> <path>  → salva o corpo em $J/out.html e imprime o status
get()  { curl -s -b "$J/$1.jar" -o "$J/out.html" -w '%{http_code}\n' "$WEB$2"; }
# form <jar> <path> <name> <venue> <startsAt> <capacity> <price>  → corpo em $J/out.html; imprime "<status> <destino>"
form() { curl -s -b "$J/$1.jar" -o "$J/out.html" -w '%{http_code} %{redirect_url}\n' --data-urlencode "name=$3" --data-urlencode "venue=$4" --data-urlencode "startsAt=$5" --data-urlencode "capacity=$6" --data-urlencode "price=$7" "$WEB$2"; }
# postempty <jar> <path>  → POST de formulário sem campos (publicar); imprime "<status> <destino>"
postempty() { curl -s -b "$J/$1.jar" -o "$J/out.html" -w '%{http_code} %{redirect_url}\n' -d '' "$WEB$2"; }
evid() { sed -E 's#.*/org/events/(evt_[a-z0-9]+).*#\1#'; }
# blk <id> <tag de fechamento>  → trecho do HTML de $J/out.html de um evento (ex.: blk "$E1" li)
blk()  { sed -n "/data-event-id=\"$1\"/,/<\/$2>/p" "$J/out.html"; }
rid()   { node -e "const a='abcdefghijklmnopqrstuvwxyz0123456789';let s='';for(let i=0;i<10;i++)s+=a[Math.floor(Math.random()*36)];console.log(s)"; }
rcode() { node -e "const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<8;i++)s+=a[Math.floor(Math.random()*32)];console.log(s)"; }
# tk <eventId> <status> <priceCents>  → fixture de ingresso (tickets ainda não existem pelo produto: F05)
tk() { sql "INSERT INTO tickets (id, event_id, buyer_email, channel, code, status, price_cents, card_last4) VALUES ('tkt_$(rid)', '$1', 'fixture-f04@example.com', 'partner', '$(rcode)', '$2', $3, '0001')"; }

FUT=$(node -e 'const d=new Date(Date.now()+30*864e5);console.log(d.toISOString().slice(0,10)+"T20:00")')
FUT2=$(node -e 'const d=new Date(Date.now()+40*864e5);console.log(d.toISOString().slice(0,10)+"T21:30")')
PAST=$(node -e 'const d=new Date(Date.now()-864e5);console.log(d.toISOString().slice(0,10)+"T20:00")')
FUTD=$(node -e 'const [d,t]=process.argv[1].split("T");const [y,m,dd]=d.split("-");console.log(dd+"/"+m+"/"+y+" "+t)' "$FUT")

login A org.a@catraca.dev; login B org.b@catraca.dev; login P participante@catraca.dev
```

   **Esperado no login (spec de F02):** `A` e `B` imprimem `303 $WEB/org/events`; `P` imprime `303 $WEB/`.
4. **Ordem:** os itens de produto rodam **na ordem numérica**, porque compartilham os eventos `E1`, `E0` e `E3` criados pelos itens anteriores.
5. **Itens "vitest":** rode `vt <arquivo> "<nome>"`. O item passa quando o comando sai com código 0, a saída mostra `✓` na linha do teste com o nome indicado, o resumo tem ≥ 1 `passed` e nenhum `failed`, e a leitura do código do teste confirma as asserções descritas.
6. Nos itens `grep -F 'data-error="<campo>"'` e `grep -F 'data-flash="error"'`, a linha impressa precisa **conter** a mensagem indicada (cada elemento fica numa linha só do HTML, spec D13).
7. No final: `npm run down`.

## Itens verificáveis

### C-F04-01 — Criação válida grava rascunho do organizador logado (produto)
- **Como:**
  ```bash
  R=$(form A /org/events/new "Jazz no Porão" "Bar do Porão" "$FUT" 2 "100,00"); echo "$R"; E1=$(echo "$R" | evid); echo "$E1" | grep -cE '^evt_[a-z0-9]{10}$'
  R0=$(form A /org/events/new "Workshop Ponto" "Sala 2" "$FUT2" 1 "100.00"); echo "$R0"; E0=$(echo "$R0" | evid)
  sql "SELECT id, status, capacity, price_cents, name, venue, to_char(starts_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD\"T\"HH24:MI'), organizer_id = (SELECT id FROM users WHERE email = 'org.a@catraca.dev'), published_at IS NULL FROM events WHERE id IN ('$E1', '$E0') ORDER BY capacity DESC"
  ```
- **Esperado:**
  - `R` = `303 $WEB/org/events/<E1>` e `R0` = `303 $WEB/org/events/<E0>`;
  - o `grep -cE` imprime `1`;
  - o SQL devolve exatamente 2 linhas:
    - `<E1>|draft|2|10000|Jazz no Porão|Bar do Porão|<FUT>|t|t`
    - `<E0>|draft|1|10000|Workshop Ponto|Sala 2|<FUT2>|t|t`

### C-F04-02 — Validação na criação: 422, formulário re-renderizado, mensagem por campo, nada criado (produto)
- **Como:** `N0=$(sql "SELECT count(*) FROM events")`. Para cada linha da tabela, rode `form A /org/events/new "<name>" "<venue>" "<startsAt>" "<capacity>" "<price>"`, depois `grep -c 'data-form="create"' "$J/out.html"` e `grep -F 'data-error="<campo>"' "$J/out.html"`. No fim, rode `sql "SELECT count(*) FROM events"`.

  | # | name | venue | startsAt | capacity | price | campo | mensagem esperada |
  |---|---|---|---|---|---|---|---|
  | a | `` | `Bar do Porão` | `$FUT` | `2` | `100,00` | `name` | `Informe o nome do evento.` |
  | b | `Jazz Teste` | `` | `$FUT` | `2` | `100,00` | `venue` | `Informe o local do evento.` |
  | c | `Jazz Teste` | `Bar do Porão` | `` | `2` | `100,00` | `startsAt` | `Informe a data e hora de início.` |
  | d | `Jazz Teste` | `Bar do Porão` | `amanhã` | `2` | `100,00` | `startsAt` | `Data e hora de início inválidas.` |
  | e | `Jazz Teste` | `Bar do Porão` | `$FUT` | `` | `100,00` | `capacity` | `Informe a lotação.` |
  | f | `Jazz Teste` | `Bar do Porão` | `$FUT` | `0` | `100,00` | `capacity` | `A lotação deve ser de pelo menos 1.` |
  | g | `Jazz Teste` | `Bar do Porão` | `$FUT` | `2.5` | `100,00` | `capacity` | `A lotação deve ser um número inteiro.` |
  | h | `Jazz Teste` | `Bar do Porão` | `$FUT` | `2` | `` | `price` | `Informe o preço.` |
  | i | `Jazz Teste` | `Bar do Porão` | `$FUT` | `2` | `0,00` | `price` | `O preço deve ser maior que zero.` |
  | j | `Jazz Teste` | `Bar do Porão` | `$FUT` | `2` | `-5` | `price` | `O preço deve ser maior que zero.` |
  | k | `Jazz Teste` | `Bar do Porão` | `$FUT` | `2` | `abc` | `price` | `Preço inválido. Use o formato 100,00.` |

- **Esperado:** em todas as linhas:
  - o `form` imprime `422` (sem destino);
  - `grep -c 'data-form="create"'` imprime `1`;
  - a linha `data-error="<campo>"` contém a mensagem esperada.

  Na linha `f`, `grep -cF 'value="Jazz Teste"' "$J/out.html"` imprime `1` (o valor enviado é preservado). O `count(*)` final é igual a `$N0`.

### C-F04-03 — Data de início no passado é rejeitada na criação (produto)
- **Como:** `form A /org/events/new "Ontem" "Bar do Porão" "$PAST" 2 "100,00"`; `grep -F 'data-error="startsAt"' "$J/out.html"`; `sql "SELECT count(*) FROM events WHERE name = 'Ontem'"`.
- **Esperado:** `422`; a linha contém `A data de início precisa estar no futuro.`; o SQL devolve `0`.

### C-F04-04 — Rascunho fica fora da vitrine e `/events/:id` responde 404 para rascunho e cancelado (produto + vitest)
- **Como:**
  ```bash
  get V /;  grep -c "data-event-id=\"$E1\"" "$J/out.html"
  get P /;  grep -c "$E1" "$J/out.html"
  get V "/events/$E1"; grep -c "Jazz no Porão" "$J/out.html"
  vt test/f04/public.test.ts "rascunho e cancelado ficam fora da vitrine e respondem 404"
  ```
- **Esperado:**
  - `200` e `0`; `200` e `0`; `404` e `0`;
  - o teste passa. Ele afirma que, para eventos `draft` e `cancelled` (fixture `createEvent({ status })`), `GET /` não contém `data-event-id="<id>"`, `GET /events/<id>` responde 404 sem o nome, e `listOnSaleEvents()` não devolve esses ids.

### C-F04-05 — Página de gestão do rascunho: id, dados, edição, publicar e slots (produto + vitest)
- **Como:**
  ```bash
  get A "/org/events/$E1"
  grep -c "<code data-field=\"id\">$E1</code>" "$J/out.html"
  grep -c 'data-form="edit"' "$J/out.html";    grep -c "action=\"/org/events/$E1\"" "$J/out.html"
  grep -c 'data-form="publish"' "$J/out.html"; grep -c "action=\"/org/events/$E1/publish\"" "$J/out.html"
  for s in panel checkin cancel; do grep -c "data-slot=\"$s\"" "$J/out.html"; done
  grep -cF "value=\"$FUT\"" "$J/out.html"; grep -cF 'value="100,00"' "$J/out.html"; grep -cF 'value="Jazz no Porão"' "$J/out.html"
  grep -F 'data-event-status="draft"' "$J/out.html"; grep -F 'data-seat="available"' "$J/out.html"
  vt test/f04/manage.test.ts "página de gestão mostra id, dados, edição, publicar e slots"
  ```
- **Esperado:**
  - `200`;
  - todos os `grep -c` imprimem `1`, inclusive os 3 slots;
  - a linha `data-event-status="draft"` contém `rascunho`, e a linha `data-seat="available"` contém `>2<`;
  - o teste passa.

### C-F04-06 — Publicação: aparece na vitrine com nome, data, local, preço e vagas (produto + vitest)
- **Como:**
  ```bash
  postempty A "/org/events/$E1/publish"
  sql "SELECT status, published_at IS NOT NULL FROM events WHERE id = '$E1'"
  get V /; blk "$E1" li; grep -c "$E0" "$J/out.html"
  get V "/events/$E1"; grep -c "data-event-id=\"$E1\"" "$J/out.html"; grep -c 'data-slot="buy"' "$J/out.html"
  get A "/org/events/$E1"; grep -c 'data-form="publish"' "$J/out.html"; grep -c 'data-form="edit"' "$J/out.html"
  postempty A "/org/events/$E1/publish"; grep -F 'data-flash="error"' "$J/out.html"
  vt test/f04/public.test.ts "vitrine lista publicados com nome, data, local, preço e vagas"
  ```
- **Esperado:**
  - o 1º `postempty` imprime `303 $WEB/org/events/<E1>`;
  - o SQL devolve `published|t`;
  - na vitrine (`200`), o bloco de `E1` contém `href="/events/<E1>"`, `data-field="name">Jazz no Porão<`, `data-field="startsAt"><FUTD><`, `data-field="venue">Bar do Porão<`, `data-field="price">R$ 100,00<` e `data-field="available">2<`; `E0` (rascunho) não aparece (`0`);
  - `/events/<E1>` responde `200`, com `1` e `1`;
  - a gestão mostra publicar `0` e edição `1`;
  - o 2º `postempty` imprime `409`, e a linha de flash contém `O evento já está publicado.`;
  - o teste passa.

### C-F04-07 — Edição válida: aumentar e reduzir lotação (sem ocupadas) e mudar preço (produto)
- **Como:**
  ```bash
  form A "/org/events/$E1" "Jazz no Porão" "Bar do Porão" "$FUT" 3 "150,00"; sql "SELECT capacity, price_cents FROM events WHERE id = '$E1'"
  form A "/org/events/$E1" "Jazz no Porão" "Bar do Porão" "$FUT" 2 "150,00"; sql "SELECT capacity, price_cents FROM events WHERE id = '$E1'"
  get V /; blk "$E1" li
  ```
- **Esperado:**
  - o 1º `form` imprime `303 $WEB/org/events/<E1>`, e o SQL devolve `3|15000`;
  - o 2º imprime `303 $WEB/org/events/<E1>`, e o SQL devolve `2|15000`;
  - o bloco da vitrine contém `R$ 150,00` e `data-field="available">2<`.

### C-F04-08 — Validação na edição, inclusive data no passado, sem alterar nada (produto + vitest)
- **Como:** `U0=$(sql "SELECT updated_at FROM events WHERE id = '$E1'")`. Para cada linha, rode `form A "/org/events/$E1" "<name>" "Bar do Porão" "<startsAt>" "<capacity>" "<price>"`, depois `grep -c 'data-form="edit"' "$J/out.html"` e `grep -F 'data-error="<campo>"' "$J/out.html"`.

  | # | name | startsAt | capacity | price | campo | mensagem |
  |---|---|---|---|---|---|---|
  | a | `Jazz no Porão` | `$FUT` | `0` | `150,00` | `capacity` | `A lotação deve ser de pelo menos 1.` |
  | b | `Jazz no Porão` | `$FUT` | `2` | `0,00` | `price` | `O preço deve ser maior que zero.` |
  | c | `Jazz no Porão` | `$PAST` | `2` | `150,00` | `startsAt` | `A data de início precisa estar no futuro.` |
  | d | `` | `$FUT` | `2` | `150,00` | `name` | `Informe o nome do evento.` |

  Depois: `sql "SELECT capacity, price_cents, name, updated_at = '$U0' FROM events WHERE id = '$E1'"` e `vt test/f04/edit.test.ts "edição valida os campos como na criação"`.
- **Esperado:**
  - cada `form` imprime `422`, com `data-form="edit"` = `1` e a mensagem na linha `data-error`;
  - o SQL devolve `2|15000|Jazz no Porão|t`;
  - o teste passa.

### C-F04-09 — Lotação × vagas ocupadas sob `lockEvent` (vitest, fixture `insertTicket`)
- **Como:** `vt test/f04/edit.test.ts "lotação abaixo das vagas ocupadas é rejeitada e igual ou acima é aceita"`; `vt test/f04/edit.test.ts "edição espera o lock do evento e usa as vagas ocupadas atuais"`.
- **Esperado:** os 2 testes passam. Eles afirmam:
  - evento com lotação 3 e tickets `pending`, `confirmed`, `declined`, `cancelled`, `refunded` (ocupadas = 2):
    - editar para 1 → `422`, com `A lotação não pode ser menor que as vagas ocupadas (2).` e a lotação continua 3;
    - editar para 2 → `303`, lotação 2;
    - editar para 5 → `303`, lotação 5;
  - lock: com a lotação 3 e 1 ticket `pending`, um cliente segura `lockEvent`. Um `POST` de edição para lotação 2 **não** responde em 500 ms. O cliente insere 2 tickets `pending` e faz `COMMIT`. A edição então responde `422` com `(3)`, e a lotação continua 3.

### C-F04-10 — Vagas ocupadas e preço vigente no produto (produto, fixture SQL de tickets)
- **Como:**
  ```bash
  tk "$E1" pending 10000; tk "$E1" confirmed 10000; tk "$E1" declined 10000; tk "$E1" refunded 10000
  get A "/org/events/$E1"; grep -F 'data-seat="occupied"' "$J/out.html"; grep -F 'data-seat="available"' "$J/out.html"
  get V /; blk "$E1" li | grep -F 'data-field="available"'
  form A "/org/events/$E1" "Jazz no Porão" "Bar do Porão" "$FUT" 1 "150,00"; grep -F 'data-error="capacity"' "$J/out.html"
  sql "SELECT capacity FROM events WHERE id = '$E1'"
  form A "/org/events/$E1" "Jazz no Porão" "Bar do Porão" "$FUT" 2 "120,00"
  sql "SELECT price_cents FROM events WHERE id = '$E1'"; sql "SELECT status, price_cents FROM tickets WHERE event_id = '$E1' ORDER BY status"
  form A "/org/events/$E1" "Jazz no Porão" "Bar do Porão" "$FUT" 3 "120,00"
  get V /; blk "$E1" li
  ```
- **Esperado:**
  - na gestão, `data-seat="occupied"` contém `>2<` e `data-seat="available"` contém `>0<`;
  - a vitrine mostra `data-field="available">0<`;
  - editar para 1 → `422`, com `A lotação não pode ser menor que as vagas ocupadas (2).`, e o SQL devolve `2`;
  - editar para 2 com preço `120,00` → `303 $WEB/org/events/<E1>`;
  - o preço do evento passa a `12000`, e os tickets continuam `confirmed|10000`, `declined|10000`, `pending|10000`, `refunded|10000`;
  - editar para 3 → `303`, e a vitrine mostra `R$ 120,00` e `data-field="available">1<`.

### C-F04-11 — `getSeatCounts` segue R05 (vitest, fixtures)
- **Como:** `vt test/f04/repo.test.ts "getSeatCounts conta pending e confirmed e zera em evento cancelado"`.
- **Esperado:** passa. O teste afirma:
  - lotação 5 com tickets `pending`, `confirmed`, `confirmed` com check-in, `declined`, `cancelled` e `refunded` → `{ capacity: 5, occupied: 3, available: 2 }`;
  - `createEvent({ status: 'cancelled', capacity: 5 })` com 1 `pending` → `available: 0`;
  - lotação 1 com 2 `confirmed` → `available: 0`;
  - id inexistente → `{ capacity: 0, occupied: 0, available: 0 }`.

### C-F04-12 — Mudar o preço não altera ingressos existentes (vitest, fixture)
- **Como:** `vt test/f04/edit.test.ts "mudar o preço não altera o price_cents de ingressos existentes"`.
- **Esperado:** passa. O teste afirma: evento a 10000 com 2 tickets a 10000; `POST` de edição com `price=150,00` → `303`; `events.price_cents = 15000`; os 2 tickets continuam com `price_cents = 10000` e `updated_at` inalterado.

### C-F04-13 — Evento cancelado: fora da vitrine, 404 público, sem edição nem publicação (produto + vitest, fixture)
- **Como:**
  ```bash
  R3=$(form A /org/events/new "Show Cancelado" "Bar 3" "$FUT" 5 "50,00"); E3=$(echo "$R3" | evid); postempty A "/org/events/$E3/publish"
  sql "UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = '$E3'"    # fixture do cancelamento (F08)
  S3=$(sql "SELECT name, capacity, price_cents, status, updated_at FROM events WHERE id = '$E3'")
  get V /; grep -c "$E3" "$J/out.html"
  get V "/events/$E3"
  get A "/org/events/$E3"; grep -c 'data-form="edit"' "$J/out.html"; grep -c 'data-form="publish"' "$J/out.html"; grep -F 'data-event-status="cancelled"' "$J/out.html"; grep -F 'data-seat="available"' "$J/out.html"; grep -c 'data-slot="cancel"' "$J/out.html"
  form A "/org/events/$E3" "Show Editado" "Bar 3" "$FUT" 9 "60,00"; grep -F 'data-flash="error"' "$J/out.html"
  postempty A "/org/events/$E3/publish"; grep -F 'data-flash="error"' "$J/out.html"
  [ "$(sql "SELECT name, capacity, price_cents, status, updated_at FROM events WHERE id = '$E3'")" = "$S3" ] && echo inalterado
  vt test/f04/manage.test.ts "evento cancelado não mostra edição nem publicar e rejeita POSTs"
  ```
- **Esperado:**
  - o publish imprime `303`;
  - a vitrine dá `200` e `0`; `/events/<E3>` dá `404`;
  - a gestão dá `200`, com edição `0` e publicar `0`, uma linha `data-event-status="cancelled"` contendo `cancelado`, `data-seat="available"` contendo `>0<` e o slot cancel `1`;
  - a edição dá `409`, com flash `Evento cancelado não pode ser editado.`;
  - a publicação dá `409`, com flash `Evento cancelado não pode ser publicado.`;
  - imprime `inalterado`;
  - o teste passa. Ele repete essas asserções com a fixture `createEvent({ status: 'cancelled' })`.

### C-F04-14 — `/org/events` lista só os eventos do organizador logado (produto + vitest)
- **Como:**
  ```bash
  get A /org/events; grep -c "data-event-id=\"$E1\"" "$J/out.html"; grep -c "data-event-id=\"$E0\"" "$J/out.html"
  get B /org/events; grep -c "$E1" "$J/out.html"; grep -c "$E0" "$J/out.html"; grep -c "Jazz no Porão" "$J/out.html"
  vt test/f04/org.test.ts "lista de eventos mostra só os do organizador logado"
  ```
- **Esperado:** A: `200`, `1`, `1`. B: `200`, `0`, `0`, `0`. O teste passa.

### C-F04-15 — Outro organizador recebe 404 sem dados em GET e em todos os POSTs de F04 (produto + vitest)
- **Como:**
  ```bash
  get B "/org/events/$E1"; grep -c "Jazz no Porão" "$J/out.html"; grep -c 'data-field=' "$J/out.html"; grep -c 'data-seat=' "$J/out.html"
  form B "/org/events/$E1" "Invasão" "X" "$FUT" 50 "1,00"; grep -c "Jazz no Porão" "$J/out.html"
  postempty B "/org/events/$E0/publish"; grep -c "Workshop Ponto" "$J/out.html"
  sql "SELECT name, capacity, status FROM events WHERE id IN ('$E1', '$E0') ORDER BY name"
  vt test/f04/org.test.ts "outro organizador recebe 404 sem dados em GET e POST"
  ```
- **Esperado:**
  - GET: `404`, `0`, `0`, `0`;
  - edição: `404` e `0`;
  - publicação: `404` e `0`;
  - o SQL devolve `Jazz no Porão|3|published` e `Workshop Ponto|1|draft`;
  - o teste passa.

### C-F04-16 — XC: área de organizador protegida pelos guards de F02 (produto + vitest)
- **Como:**
  ```bash
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$WEB/org/events"
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$WEB/org/events/$E1"
  N2=$(sql "SELECT count(*) FROM events")
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --data-urlencode "name=Visitante" --data-urlencode "venue=X" --data-urlencode "startsAt=$FUT" -d capacity=1 --data-urlencode "price=1,00" "$WEB/org/events/new"
  sql "SELECT count(*) FROM events"
  get P /org/events; grep -c "Jazz no Porão" "$J/out.html"
  get P "/org/events/$E1"; grep -c "Jazz no Porão" "$J/out.html"
  vt test/f04/org.test.ts "visitante é redirecionado e participante recebe 403"
  ```
- **Esperado:**
  - os 3 `curl` de visitante imprimem `302` com destino começando por `$WEB/login`;
  - o `count(*)` continua igual a `$N2`;
  - o participante recebe `403` e `0`, e `403` e `0`;
  - o teste passa.

### C-F04-17 — XC: o schema de F01 reforça a validação de F04 (produto)
- **Como:**
  ```bash
  N3=$(sql "SELECT count(*) FROM events")
  sql "INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents) SELECT 'evt_cap0f04xyz', id, 'Cap zero', 'X', now() + interval '30 days', 0, 1000 FROM users WHERE email = 'org.a@catraca.dev'"; echo "exit=$?"
  sql "INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents) SELECT 'evt_prc0f04xyz', id, 'Preço zero', 'X', now() + interval '30 days', 1, 0 FROM users WHERE email = 'org.a@catraca.dev'"; echo "exit=$?"
  sql "SELECT count(*) FROM events"
  sql "SELECT e.organizer_id = u.id FROM events e, users u WHERE e.id = '$E1' AND u.email = 'org.a@catraca.dev'"
  ```
- **Esperado:**
  - os 2 INSERTs imprimem um erro contendo `violates check constraint` e `exit=` diferente de 0;
  - o `count(*)` é igual a `$N3`;
  - o último SQL devolve `t`.

### C-F04-18 — Funções de repositório: dono, status, lock e eventos à venda (vitest)
- **Como:** `vt test/f04/repo.test.ts "getOwnedEvent e getPublicEvent filtram dono e status"`; `vt test/f04/repo.test.ts "lockEvent bloqueia uma segunda transação até o commit"`; `vt test/f04/repo.test.ts "listOnSaleEvents devolve só published com available"`.
- **Esperado:** os 3 testes passam. Eles afirmam:
  - `getOwnedEvent(A, evA)` devolve a linha, e `getOwnedEvent(B, evA)` e um id inexistente devolvem `null`;
  - `getPublicEvent` devolve só `published` (`draft`, `cancelled` e inexistente → `null`);
  - lock: um 2º `lockEvent` no mesmo id não resolve em 500 ms enquanto o 1º não faz commit e resolve depois do commit; `lockEvent` de id inexistente → `null`;
  - com eventos `draft`, `published` (×2, datas diferentes) e `cancelled`, `listOnSaleEvents()` devolve só os 2 publicados, ordenados por `starts_at`, com `available` = lotação − (`pending` + `confirmed`).

### C-F04-19 — Slots e partials vazios para F05/F07/F08 e registro de seções (inspeção + vitest)
- **Como:**
  ```bash
  for f in purchases/_buy checkin/_panel checkin/_checkin cancel/_cancel; do test -f "src/views/$f.ejs" && echo "ok $f"; done
  grep -c "include('../purchases/_buy', locals)" src/views/events/show.ejs
  for p in "checkin/_panel" "checkin/_checkin" "cancel/_cancel"; do grep -c "include('../$p', locals)" src/views/org/manage.ejs; done
  vt test/f04/manage.test.ts "os partials dos slots existem e não renderizam nada"
  vt test/f04/manage.test.ts "registerManageSection injeta o retorno em buildManageLocals"
  vt test/f04/manage.test.ts "renderManagePage aplica o status e os extras do chamador"
  ```
- **Esperado:**
  - 4 linhas `ok …`;
  - os 4 `grep -c` imprimem `1`;
  - os 3 testes passam. Eles afirmam:
    - cada partial renderiza uma string que, depois de `trim()`, é vazia;
    - depois de `registerManageSection('f04-teste', async ({ event }) => ({ f04Eco: event.id }))`, `buildManageLocals(ev, org)` contém `f04Eco === ev.id` (retorno mesclado de forma rasa, spec §4.1), além de `event`, `seats` (`capacity`, `occupied`, `available`), `canEdit` e `canPublish`;
    - uma rota que faz `reply.code(409)` e `renderManagePage(reply, ev, org, { flashError: 'Mensagem de teste' })` responde `409` com `data-flash="error"` contendo `Mensagem de teste`.

### C-F04-20 — `validateEventInput` e formatadores (vitest)
- **Como:** `vt test/f04/validation.test.ts "validateEventInput aceita entrada válida e converte os valores"`; `vt test/f04/validation.test.ts "validateEventInput rejeita cada campo com a mensagem definida"`; `vt test/f04/validation.test.ts "validateEventInput rejeita data de início no passado"`; `vt test/f04/validation.test.ts "formatadores de data e preço usam America/Sao_Paulo"`.
- **Esperado:** os 4 testes passam. Eles afirmam:
  - `"100,00"` e `"100.00"` → `priceCents 10000`;
  - `startsAt "2026-12-05T21:00"` → `2026-12-06T00:00:00.000Z`;
  - `capacity "3"` → `3`, e `name`/`venue` com `trim`;
  - cada linha da tabela de validação da spec §8 (inclusive campo **ausente** do objeto e campo duplicado em array) dá a mensagem literal no campo correspondente;
  - com `now` injetado, um instante igual ou anterior a `now` → `A data de início precisa estar no futuro.`;
  - `formatEventDateTime(new Date('2026-12-06T00:00:00Z')) === '05/12/2026 21:00'`, `toDateTimeLocalValue(...) === '2026-12-05T21:00'` e `centsToPriceInput(15000) === '150,00'`.

### C-F04-21 — Publicação só a partir de rascunho, sob lock (vitest)
- **Como:** `vt test/f04/publish.test.ts "publicação aceita só rascunho"`; `vt test/f04/publish.test.ts "duas publicações simultâneas resultam em uma 303 e uma 409"`.
- **Esperado:** os 2 testes passam. Eles afirmam:
  - `draft` → `303`, com status `published` e `published_at` preenchido;
  - `published` → `409`, com `O evento já está publicado.`;
  - `cancelled` (fixture) → `409`, com `Evento cancelado não pode ser publicado.`, sem alterar a linha;
  - dois `POST /publish` simultâneos (`Promise.all` de `inject`) no mesmo rascunho → exatamente um `303` e um `409`.

### C-F04-22 — Escopo de arquivos da branch (inspeção)
- **Como:** `git diff --name-status main...HEAD`.
- **Esperado:**
  - só aparecem arquivos de `src/events/`, `src/views/events/`, `src/views/org/`, os 4 partials (`src/views/purchases/_buy.ejs`, `src/views/checkin/_panel.ejs`, `src/views/checkin/_checkin.ejs`, `src/views/cancel/_cancel.ejs`), `test/f04/`, `src/features.ts`, `state/project-state.json` e, opcionalmente, `docs/features/F04-eventos/` (sem `reports/`). **Não** aparecem `src/server.ts`, `src/views/home.ejs`, `src/auth/`, `src/gateway/`, `test/helpers.ts` nem `migrations/`;
  - `git diff main...HEAD -- src/features.ts` acrescenta só o import e a linha `/* F04 */ eventsPublicRoutes, eventsOrgRoutes,`;
  - em `state/project-state.json`, só a entrada `F04` mudou, com `"status": "implemented"`;
  - **exceção admitida (emenda do orquestrador, antes da avaliação):** `test/f02/guards.test.ts` pode aparecer, desde que `git diff main...HEAD -- test/f02/guards.test.ts` troque **apenas** a URL de exemplo de rota `/org/*` inexistente (`/org/events` → outra rota inexistente, ex.: `/org/rota-inexistente`), mantendo a expectativa `404`. Motivo: o teste de F02 usava `/org/events` como exemplo de rota que ainda não existia; a F04 passa a servir essa rota, de modo que o teste deixaria de ser válido. O desvio está registrado na spec da F04 (§12).

### C-F04-23 — Gates verdes (comando)
- **Como:** `npm run gates; echo "exit=$?"` e depois `docker ps --filter "name=$COMPOSE_PROJECT_NAME-gates" -q | wc -l`.
- **Esperado:**
  - `exit=0`;
  - lint e typecheck sem erro e `test/f04/*.test.ts` executados sem falhas, com os testes de F01–F03 também verdes;
  - a contagem de containers é `0`.

## Mapeamento PRD → contrato

- AC-F04-01 → C-F04-01, C-F04-02, C-F04-20
- AC-F04-02 → C-F04-03, C-F04-08, C-F04-20
- AC-F04-03 → C-F04-01, C-F04-04, C-F04-13, C-F04-18
- AC-F04-04 → C-F04-06, C-F04-18, C-F04-21
- AC-F04-05 → C-F04-05, C-F04-06, C-F04-13, C-F04-19
- AC-F04-06 → C-F04-07, C-F04-09, C-F04-10, C-F04-18
- AC-F04-07 → C-F04-10, C-F04-11
- AC-F04-08 → C-F04-14, C-F04-15, C-F04-18
- AC-F04-09 → C-F04-10, C-F04-12
- AC-F04-10 → C-F04-07, C-F04-08
- AC-F04-11 → C-F04-01, C-F04-05, C-F04-06
- XC-F04-F01-01 → C-F04-01, C-F04-17
- XC-F04-F02-01 → C-F04-14, C-F04-15, C-F04-16

Itens transversais, sem critério específico do PRD e exigidos pelas regras 8 e 9 do AGENTS.md: C-F04-22 e C-F04-23.
