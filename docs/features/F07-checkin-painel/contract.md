# Contrato — F07 Check-in & Painel

O avaliador verifica **exatamente** os itens abaixo. Cada item diz como verificar e qual é o resultado esperado observável. Um item só passa se o resultado observado for o esperado.

## Pré-requisitos de ambiente

1. Branch `feat/F07-checkin-painel` (HEAD avaliado), com F01–F05 já integradas na `main`. F06 **não** é necessária: nenhum item usa a API HTTP de parceiros.
2. Ambiente isolado:
   ```bash
   export COMPOSE_PROJECT_NAME=catraca-f07-eval CATRACA_PORT=3107
   unset GATEWAY_DELAY_SCALE          # modo padrão: escala 1
   npm run down; npm run up           # sobe build + migrações + seed; retorna com /healthz 200
   ```
3. Ferramentas: Docker, Git, Node.js LTS e `curl`. Nenhum item exige `jq`. Os itens ao vivo rodam **em sequência no mesmo shell**: as variáveis definidas em um item (`$E`, `$C1`…) são usadas nos seguintes.
4. Helpers de shell (colar uma vez no shell do avaliador, dentro da raiz do repositório):
   ```bash
   export WEB="http://localhost:${CATRACA_PORT:-3000}"; export J="$(mktemp -d)"; export TS="$(date +%s)"
   cat > "$J/h.mjs" <<'EOF'
   const [mode, arg] = process.argv.slice(2);
   let s = ''; for await (const c of process.stdin) s += c;
   const attr = (t, a) => (t.match(new RegExp(a + '="([^"]*)"')) || [])[1];
   if (mode === 'panel') {
     console.log(['confirmed','pending','checkins','available','revenue','refunded'].map((k) => {
       const m = s.match(new RegExp('data-metric="' + k + '"[^>]*>([^<]*)<'));
       return k + '=' + (m ? m[1].trim() : '<ausente>');
     }).join(' | ') + (/ |&nbsp;/.test(s) ? ' | NBSP!' : ''));
   } else if (mode === 'result') {
     const m = s.match(/data-checkin-result[^>]*>([^<]*)</); console.log(m ? m[1].trim() : '<ausente>');
   } else if (mode === 'tickets') {
     for (const t of s.match(/<[^>]*data-ticket-code="[^"]*"[^>]*>/g) || []) console.log(attr(t, 'data-ticket-code'), attr(t, 'data-ticket-status'));
   } else if (mode === 'has') { console.log(s.includes(arg) ? 'SIM' : 'NAO'); }
   EOF
   login()  { curl -s -o /dev/null -c "$J/$1" -b "$J/$1" --data-urlencode "email=$2" --data-urlencode "password=catraca123" "$WEB/login"; }
   signup() { curl -s -o /dev/null -c "$J/$1" -b "$J/$1" --data-urlencode "name=Participante Contrato" --data-urlencode "email=$2" --data-urlencode "password=catraca123" "$WEB/signup"; }
   future() { node -e 'console.log(new Date(Date.now()+30*864e5).toLocaleDateString("sv-SE",{timeZone:"America/Sao_Paulo"})+"T21:00")'; }
   new_event() { curl -s -i -b "$J/$1" --data-urlencode "name=$2" --data-urlencode "venue=Bar do Contrato" --data-urlencode "startsAt=$(future)" --data-urlencode "capacity=$3" --data-urlencode "price=$4" "$WEB/org/events/new" | tr -d '\r' | grep -i '^location:' | grep -oE 'evt_[a-z0-9]{10}'; }
   publish() { curl -s -o /dev/null -w '%{http_code}\n' -b "$J/$1" -d '' "$WEB/org/events/$2/publish"; }
   edit()   { curl -s -o /dev/null -w '%{http_code}\n' -b "$J/$1" --data-urlencode "name=$3" --data-urlencode "venue=Bar do Contrato" --data-urlencode "startsAt=$(future)" --data-urlencode "capacity=$4" --data-urlencode "price=$5" "$WEB/org/events/$2"; }
   buy()    { curl -s -o /dev/null -w '%{http_code}\n' -b "$J/$1" --data-urlencode "cardNumber=$3" "$WEB/events/$2/purchase"; }
   tickets(){ curl -s -b "$J/$1" "$WEB/me/tickets" | node "$J/h.mjs" tickets; }
   panel()  { curl -s -b "$J/$1" "$WEB/org/events/$2" | node "$J/h.mjs" panel; }
   checkin(){ curl -s -b "$J/$1" --data-urlencode "code=$3" "$WEB/org/events/$2/checkin" | node "$J/h.mjs" result; }
   # testes nomeados, no mesmo ambiente efêmero dos gates (Postgres próprio, derrubado ao final)
   vt() { local p="${COMPOSE_PROJECT_NAME:-catraca}-gates"; docker compose -p "$p" -f compose.gates.yaml run --rm --build gates npx vitest run --reporter=verbose "$@"; local s=$?; docker compose -p "$p" -f compose.gates.yaml down -v --remove-orphans >/dev/null 2>&1; return $s; }
   ```
   Se `new_event` não imprimir o id (F04 sem `Location` para `/org/events/evt_…`), o id é o do link `/org/events/evt_…` do nome único em `GET /org/events`.
5. Os testes vitest têm o nome iniciado pelo ID do item. `vt test/f07/<arquivo> -t "C-F07-nn"` roda só os testes do item. A evidência é a(s) linha(s) `✓ … C-F07-nn …` e `Tests  N passed` sem nenhum `failed`. Se F01 tiver um atalho equivalente documentado para rodar um teste dentro do ambiente dos gates, ele também vale.
6. Estado inicial: a seed carregada (org A `org.a@catraca.dev`, org B `org.b@catraca.dev`, participante `participante@catraca.dev`, todos com a senha `catraca123`). Os itens ao vivo criam eventos e contas com nomes únicos (`$TS`), então não exigem banco vazio.

## Itens verificáveis

### Gates

- **C-F07-01:** gates verdes com os testes de F07.
  - **Como:** `npm run gates; echo "exit=$?"`
  - **Esperado:** `exit=0`. A saída mostra lint e typecheck sem erros e os arquivos `test/f07/*.test.ts` executados sem falha. Nenhum container `*-gates` continua rodando (`docker ps`).

### Check-in: regras de R10 (testes com fixtures)

- **C-F07-02:** mensagens literais.
  - **Como:** `vt test/f07/checkin.service.test.ts -t "C-F07-02"`
  - **Esperado:** o teste passa. `CHECKIN_MESSAGES` é deep-equal a `{ invalid: 'Ingresso inválido para este evento', cancelled: 'Evento cancelado', notConfirmed: 'Ingresso não confirmado', used: 'Ingresso já utilizado', ok: 'Entrada liberada' }`.
- **C-F07-03:** R10-1, código inexistente ou vazio.
  - **Como:** `vt test/f07/checkin.service.test.ts -t "C-F07-03"`
  - **Esperado:** o teste passa. `checkIn(evt, 'ZZZZZZZZ')`, `checkIn(evt, '')` e `checkIn(evt, '   ')` devolvem `'invalid'`.
- **C-F07-04:** R10-1, código confirmado de **outro** evento.
  - **Como:** `vt test/f07/checkin.service.test.ts -t "C-F07-04"`
  - **Esperado:** o teste passa. `checkIn(E1, códigoDeE2)` devolve `'invalid'`, e o ticket de E2 continua com `checked_in_at IS NULL`.
- **C-F07-05:** R10-1 tem precedência sobre R10-2.
  - **Como:** `vt test/f07/checkin.service.test.ts -t "C-F07-05"`
  - **Esperado:** o teste passa. Em um evento `createEvent({ status: 'cancelled' })`, um código inexistente e um código de outro evento devolvem `'invalid'`, e não `'cancelled'`.
- **C-F07-06:** R10-2, evento cancelado (fixture).
  - **Como:** `vt test/f07/checkin.service.test.ts -t "C-F07-06"`
  - **Esperado:** o teste passa. Em evento `createEvent({ status: 'cancelled' })`, tickets `insertTicket` com `status` `refunded`, `cancelled`, `confirmed` e `refunded` + `checkedIn: true` devolvem `'cancelled'`. Nenhum `checked_in_at` é gravado.
- **C-F07-07:** R10-3, ingresso não confirmado, com precedência sobre R10-4.
  - **Como:** `vt test/f07/checkin.service.test.ts -t "C-F07-07"`
  - **Esperado:** o teste passa. Em evento publicado, tickets `pending`, `declined`, `cancelled` e `refunded` devolvem `'notConfirmed'`. Um ticket `declined` com `checkedIn: true` também devolve `'notConfirmed'`, e não `'used'`.
- **C-F07-08:** R10-5 e R10-4, a entrada liberada uma única vez.
  - **Como:** `vt test/f07/checkin.service.test.ts -t "C-F07-08"`
  - **Esperado:** o teste passa. O primeiro `checkIn` de um ticket `confirmed` devolve `'ok'` e grava `checked_in_at` não nulo, mantendo `status = 'confirmed'`. O segundo devolve `'used'` e `checked_in_at` continua com o valor do primeiro.
- **C-F07-09:** normalização do código (AC-F07-07).
  - **Como:** `vt test/f07/checkin.service.test.ts -t "C-F07-09"`
  - **Esperado:** o teste passa. Para o código `K7Q2M9XA`, `checkIn(evt, '  k7q2m9xa ')` devolve `'ok'` e, em seguida, `checkIn(evt, 'K7q2M9xA')` devolve `'used'`.
- **C-F07-10:** concorrência, 10 check-ins simultâneos do mesmo código.
  - **Como:** `vt test/f07/checkin.service.test.ts -t "C-F07-10"`
  - **Esperado:** o teste passa nas 10 rodadas. Em cada uma, `Promise.all` de 10 `checkIn` com o mesmo código (variando caixa e espaços) resulta em **exatamente 1** `'ok'` e 9 `'used'`.
- **C-F07-24:** inspeção dos locks do check-in.
  - **Como:** `grep -nE "FOR UPDATE|FOR SHARE|toUpperCase|trim\(" src/checkin/service.ts`
  - **Esperado:** aparecem um `FOR SHARE` na consulta de `events`, um `FOR UPDATE` na consulta de `tickets` filtrada por `code` **e** `event_id`, e a normalização `trim()` + `toUpperCase()`.

### Painel (R12)

- **C-F07-11:** definições de `getPanel`.
  - **Como:** `vt test/f07/panel.test.ts -t "C-F07-11"`
  - **Esperado:** o teste passa. O evento publicado tem lotação 10 e estes tickets: 3 `confirmed` (10000, 10000 e 15000; um com check-in), 2 `pending`, 1 `declined`, 1 `cancelled` e 2 `refunded` (um com check-in). `getPanel` devolve `{ confirmed: 3, pending: 2, checkins: 1, available: 5, revenueCents: 35000, refunded: 2 }`. O mesmo conjunto em evento `cancelled` (fixture) devolve `available: 0`.
- **C-F07-12:** HTML do painel com `data-metric` e `formatBRL`.
  - **Como:** `vt test/f07/panel.test.ts -t "C-F07-12"`
  - **Esperado:** o teste passa. O `GET /org/events/:id` do dono contém os elementos `data-metric="confirmed"`, `"pending"`, `"checkins"`, `"available"`, `"revenue"` e `"refunded"`, cada um com só o valor como texto, e os rótulos `Confirmados`, `Pendentes`, `Check-ins`, `Vagas disponíveis`, `Receita` e `Estornados`. Para o conjunto de C-F07-11, `revenue` vale exatamente `R$ 350,00` com U+0020, e o HTML não contém ` ` nem `&nbsp;`. Num evento sem vendas, `revenue` vale `R$ 0,00`.

### Rota e acesso (R13)

- **C-F07-13:** check-in pela rota, como dono.
  - **Como:** `vt test/f07/routes.test.ts -t "C-F07-13"`
  - **Esperado:** o teste passa. `POST /org/events/:id/checkin` com `code=<confirmado>` e o cookie do dono responde `200`. O HTML contém `<p data-checkin-result="ok">Entrada liberada</p>` e `data-metric="checkins"` com `1` na mesma resposta. Repetir o POST mostra `Ingresso já utilizado`.
- **C-F07-14:** outro organizador.
  - **Como:** `vt test/f07/routes.test.ts -t "C-F07-14"`
  - **Esperado:** o teste passa. O org B faz `POST /org/events/<evento de A>/checkin` com um código confirmado e recebe `404`, num corpo sem o nome do evento, sem `data-metric` e sem `data-checkin-result`. O ticket continua com `checked_in_at IS NULL`. O `GET /org/events/<evento de A>` do org B também responde `404`, sem `data-metric`.
- **C-F07-15:** participante e visitante.
  - **Como:** `vt test/f07/routes.test.ts -t "C-F07-15"`
  - **Esperado:** o teste passa. O participante logado recebe `403` sem `data-metric` nem nome do evento. O visitante recebe `302` com `Location` começando por `/login`. Nos dois casos, o ticket continua sem check-in.

### Cross-feature (testes)

- **C-F07-16:** XC-F07-F04-01, Vagas disponíveis acompanha a edição de F04.
  - **Como:** `vt test/f07/cross.test.ts -t "C-F07-16"`
  - **Esperado:** o teste passa. Evento de lotação 2 com 2 compras `purchaseTicket` pendentes: painel `available = 0 = getSeatCounts().available`. Depois de `POST /org/events/:id` com lotação 3 (rota de F04): painel `available = 1 = getSeatCounts().available`.
- **C-F07-17:** XC-F07-F05-01, cenário do passo 9 do brief.
  - **Como:** `vt test/f07/cross.test.ts -t "C-F07-17"`
  - **Esperado:** o teste passa. O evento tem lotação 2 e preço R$ 100,00. Há 1 compra `web` (participante) e 1 `partner` (`purchaseTicket`), ambas `0001` e confirmadas pelo dispatcher local. Depois, `POST /org/events/:id` muda o preço para `150,00` e a lotação para 3, e mais 1 compra `partner` `0001` é confirmada. O HTML do painel mostra `confirmed=3`, `pending=0`, `checkins=0`, `available=0`, `revenue=R$ 350,00` e `refunded=0`. Os `price_cents` dos tickets são `[10000, 10000, 15000]`.
- **C-F07-18:** XC-F07-F05-02, códigos de F05 de qualquer canal.
  - **Como:** `vt test/f07/cross.test.ts -t "C-F07-18"`
  - **Esperado:** o teste passa. Os resultados são:
    - código `web` confirmado → `Entrada liberada`;
    - código `partner` ainda `pending` → `Ingresso não confirmado`;
    - código `partner` com o cartão `4000000000000002` depois de `declined` → `Ingresso não confirmado`;
    - código confirmado de outro evento → `Ingresso inválido para este evento`.
- **C-F07-19:** XC-F07-F05-03, rajada de 30 `purchaseTicket` com o painel em ≤ 10 s, em escala 1.
  - **Como:** `vt test/f07/burst.test.ts -t "C-F07-19"`
  - **Esperado:** o teste passa nas 3 rodadas. Em cada uma, um evento novo de lotação 5 recebe 30 `purchaseTicket` simultâneos (`partner`, `4000000000000001`), com o dispatcher local em `SimulatedGateway({ scale: 1 })`. Resultado: exatamente 5 `ok` e 25 `sold_out`. Em ≤ 10 s, contados a partir do disparo, `getPanel` e o HTML mostram `confirmed=5`, `pending=0`, `available=0` e receita igual a 5 × preço. Em nenhum momento `confirmed + pending` passa de 5.

### Ao vivo (produto no ar, escala 1)

- **C-F07-20:** mensagens de R10 no produto (ordem, normalização e outro evento).
  - **Como:**
    ```bash
    login orgA org.a@catraca.dev
    signup p7 "p7-$TS@example.com"; signup p7b "p7b-$TS@example.com"
    E=$(new_event orgA "F07 Checkin $TS" 3 "100,00"); publish orgA "$E"
    O=$(new_event orgA "F07 Outro $TS" 2 "10,00");   publish orgA "$O"
    buy p7 "$E" 4000000000000001; buy p7 "$E" 4000000000000004; buy p7b "$O" 4000000000000001
    sleep 6; tickets p7; tickets p7b
    C1=$(tickets p7 | awk '$2=="confirmed"{print $1}'); C2=$(tickets p7 | awk '$2=="pending"{print $1}'); C3=$(tickets p7b | awk '{print $1}')
    checkin orgA "$E" ZZZZZZZZ
    checkin orgA "$E" "$C3"
    checkin orgA "$E" "$C2"
    checkin orgA "$E" "  $(echo "$C1" | tr 'A-Z' 'a-z') "
    checkin orgA "$E" "$C1"
    panel orgA "$E"
    ```
    Cole o bloco inteiro de uma vez. Ele leva menos de 15 s, bem antes dos 30 s em que o cartão `0004` é recusado, então C2 ainda está `pending`.
  - **Esperado:**
    - `publish` imprime um código que não é `4xx`/`5xx`, e cada `buy` imprime `303`.
    - Depois de 6 s, `tickets p7` mostra um código `confirmed` e um `pending`, e `tickets p7b` mostra um `confirmed`.
    - Os 5 check-ins imprimem, nesta ordem: `Ingresso inválido para este evento`, `Ingresso inválido para este evento`, `Ingresso não confirmado`, `Entrada liberada`, `Ingresso já utilizado`.
    - O painel imprime `confirmed=1 | pending=1 | checkins=1 | available=1 | revenue=R$ 100,00 | refunded=0`, sem `NBSP!`.
    - `Evento cancelado` não é verificável ao vivo antes de F08. Fica coberto por C-F07-06 (fixture) e por XC-F08-F07-01.
- **C-F07-21:** XC-F07-F05-01 e XC-F07-F04-01 ao vivo, com o passo 9 pela vitrine.
  - **Como:**
    ```bash
    signup p9 "p9-$TS@example.com"
    R=$(new_event orgA "F07 Receita $TS" 2 "100,00"); publish orgA "$R"
    buy p9 "$R" 4000000000000001; buy p9 "$R" 4000000000000001; sleep 6; panel orgA "$R"
    edit orgA "$R" "F07 Receita $TS" 3 "150,00"; panel orgA "$R"
    buy p9 "$R" 4000000000000001; sleep 6; panel orgA "$R"
    ```
  - **Esperado:**
    - O primeiro painel mostra `confirmed=2 | pending=0 | checkins=0 | available=0 | revenue=R$ 200,00 | refunded=0`.
    - `edit` imprime um código `2xx`/`3xx`, e o painel seguinte mostra `available=1` (2 → 3 com 2 ocupadas).
    - O último painel mostra **exatamente** `confirmed=3 | pending=0 | checkins=0 | available=0 | revenue=R$ 350,00 | refunded=0`.
- **C-F07-22:** acesso ao vivo (R13): org B, participante e visitante.
  - **Como:**
    ```bash
    K=$(tickets p9 | awk 'NR==1{print $1}')
    login orgB org.b@catraca.dev; login ps participante@catraca.dev
    curl -s -o "$J/b1.html" -w '%{http_code}\n' -b "$J/orgB" "$WEB/org/events/$R"
    curl -s -o "$J/b2.html" -w '%{http_code}\n' -b "$J/orgB" --data-urlencode "code=$K" "$WEB/org/events/$R/checkin"
    curl -s -o "$J/p.html"  -w '%{http_code}\n' -b "$J/ps"   --data-urlencode "code=$K" "$WEB/org/events/$R/checkin"
    curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --data-urlencode "code=$K" "$WEB/org/events/$R/checkin"
    cat "$J/b1.html" "$J/b2.html" "$J/p.html" | grep -cE "F07 Receita|data-metric|data-checkin-result"
    panel orgA "$R"; checkin orgA "$R" "$K"
    ```
  - **Esperado:**
    - Os status impressos são `404`, `404`, `403` e `302 …/login…`.
    - O `grep -c` imprime `0`.
    - O painel do dono continua com `checkins=0`, e o check-in do dono com `$K` imprime `Entrada liberada`, o que prova que as tentativas anteriores não registraram nada.
- **C-F07-23:** rajada ao vivo pela vitrine, com o painel em ≤ 10 s (complemento de XC-F07-F05-03).
  - **Como:**
    ```bash
    signup pb "pb-$TS@example.com"
    B=$(new_event orgA "F07 Rajada $TS" 5 "10,00"); publish orgA "$B"   # B = evento da rajada
    T0=$(date +%s)
    seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" -b "$J/pb" --data-urlencode "cardNumber=4000000000000001" "$WEB/events/$B/purchase" | sort | uniq -c
    for i in $(seq 40); do P=$(panel orgA "$B"); case "$P" in *"confirmed=5 |"*"available=0 |"*) echo "ok em $(( $(date +%s) - T0 )) s"; break;; esac; sleep 0.5; done; echo "$P"
    ```
  - **Esperado:**
    - `uniq -c` mostra exatamente `5 303` e `25 409`.
    - O laço imprime `ok em N s` com `N ≤ 10`.
    - O painel final é `confirmed=5 | pending=0 | checkins=0 | available=0 | revenue=R$ 50,00 | refunded=0`.
    - A mesma rajada pelo canal `partner` via HTTP é verificada no `npm run flow` (F08, passo 15).

## Mapeamento PRD → contrato

- AC-F07-01 → C-F07-02, C-F07-03, C-F07-04, C-F07-05, C-F07-06, C-F07-07, C-F07-08, C-F07-20
- AC-F07-02 → C-F07-08, C-F07-10, C-F07-13, C-F07-24, C-F07-20
- AC-F07-03 → C-F07-04, C-F07-20
- AC-F07-04 → C-F07-11, C-F07-12, C-F07-21
- AC-F07-05 → C-F07-11, C-F07-17, C-F07-21
- AC-F07-06 → C-F07-14, C-F07-22
- AC-F07-07 → C-F07-09, C-F07-24, C-F07-20
- XC-F07-F02-01 → C-F07-14, C-F07-15, C-F07-22
- XC-F07-F04-01 → C-F07-16, C-F07-21
- XC-F07-F05-01 → C-F07-17, C-F07-21
- XC-F07-F05-02 → C-F07-18, C-F07-20
- XC-F07-F05-03 → C-F07-19, C-F07-23
