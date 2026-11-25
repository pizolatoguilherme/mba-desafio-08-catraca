# Contrato — F08 Cancelamento

O avaliador verifica **exatamente** os itens abaixo. Cada item diz como verificar e qual é o resultado esperado observável. F08 é a feature integradora: vários itens exercitam F03–F07 juntas, no produto no ar.

## Pré-requisitos de ambiente

1. Branch `feat/F08-cancelamento` (HEAD avaliado), com F01–F07 já integradas na `main`.
2. Ambiente isolado, em **escala 1** (modo padrão):
   ```bash
   export COMPOSE_PROJECT_NAME=catraca-f08-eval CATRACA_PORT=3108
   unset GATEWAY_DELAY_SCALE FLOW_SCALE
   npm run down; npm run up           # build + migrações + seed; retorna com /healthz 200
   ```
3. Ferramentas: Docker, Git, Node.js LTS e `curl`. Nenhum item exige `jq` nem `npm install` no host. Os itens ao vivo rodam **em sequência no mesmo shell**: as variáveis definidas em um item são usadas nos seguintes.
4. Helpers de shell (colar uma vez, na raiz do repositório):
   ```bash
   export WEB="http://localhost:${CATRACA_PORT:-3000}" API="http://localhost:${CATRACA_PORT:-3000}"
   export KEY="${PARTNER_API_KEY:-catraca-parceiro-2026}" J="$(mktemp -d)" TS="$(date +%s)"
   cat > "$J/h.mjs" <<'EOF'
   const [mode, arg] = process.argv.slice(2);
   let s = ''; for await (const c of process.stdin) s += c;
   const attr = (t, a) => (t.match(new RegExp(a + '="([^"]*)"')) || [])[1];
   if (mode === 'panel') {
     console.log(['confirmed','pending','checkins','available','revenue','refunded'].map((k) => {
       const m = s.match(new RegExp('data-metric="' + k + '"[^>]*>([^<]*)<'));
       return k + '=' + (m ? m[1].trim() : '<ausente>');
     }).join(' | '));
   } else if (mode === 'result') { const m = s.match(/data-checkin-result[^>]*>([^<]*)</); console.log(m ? m[1].trim() : '<ausente>'); }
   else if (mode === 'tickets') { for (const t of s.match(/<[^>]*data-ticket-code="[^"]*"[^>]*>/g) || []) console.log(attr(t, 'data-ticket-code'), attr(t, 'data-ticket-status')); }
   else if (mode === 'has') { console.log(s.includes(arg) ? 'SIM' : 'NAO'); }
   else if (mode === 'json') { const o = JSON.parse(s); console.log(typeof o[arg] === 'string' ? o[arg] : JSON.stringify(o[arg])); }
   else if (mode === 'event') { const e = JSON.parse(s).find((x) => x.id === arg); console.log(e ? JSON.stringify(e) : 'ausente'); }
   EOF
   login()  { curl -s -o /dev/null -c "$J/$1" -b "$J/$1" --data-urlencode "email=$2" --data-urlencode "password=catraca123" "$WEB/login"; }
   signup() { curl -s -o /dev/null -c "$J/$1" -b "$J/$1" --data-urlencode "name=Participante Contrato" --data-urlencode "email=$2" --data-urlencode "password=catraca123" "$WEB/signup"; }
   future() { node -e 'console.log(new Date(Date.now()+30*864e5).toLocaleDateString("sv-SE",{timeZone:"America/Sao_Paulo"})+"T21:00")'; }
   new_event() { curl -s -i -b "$J/$1" --data-urlencode "name=$2" --data-urlencode "venue=Bar do Contrato" --data-urlencode "startsAt=$(future)" --data-urlencode "capacity=$3" --data-urlencode "price=$4" "$WEB/org/events/new" | tr -d '\r' | grep -i '^location:' | grep -oE 'evt_[a-z0-9]{10}'; }
   publish() { curl -s -o /dev/null -w '%{http_code}\n' -b "$J/$1" -d '' "$WEB/org/events/$2/publish"; }
   edit()   { curl -s -o /dev/null -w '%{http_code}\n' -b "$J/$1" --data-urlencode "name=$3" --data-urlencode "venue=Bar do Contrato" --data-urlencode "startsAt=$(future)" --data-urlencode "capacity=$4" --data-urlencode "price=$5" "$WEB/org/events/$2"; }
   cancel() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -b "$J/$1" -d '' "$WEB/org/events/$2/cancel"; }
   buy()    { curl -s -o /dev/null -w '%{http_code}\n' -b "$J/$1" --data-urlencode "cardNumber=$3" "$WEB/events/$2/purchase"; }
   page()   { curl -s -b "$J/$1" "$WEB/org/events/$2"; }
   tickets(){ curl -s -b "$J/$1" "$WEB/me/tickets" | node "$J/h.mjs" tickets; }
   panel()  { page "$1" "$2" | node "$J/h.mjs" panel; }
   checkin(){ curl -s -b "$J/$1" --data-urlencode "code=$3" "$WEB/org/events/$2/checkin" | node "$J/h.mjs" result; }
   api_buy(){ curl -s -o "$J/last.json" -w '%{http_code} ' -H "X-Api-Key: $KEY" -H 'Content-Type: application/json' -d "{\"buyerEmail\":\"$2\",\"cardNumber\":\"$3\"}" "$API/api/partner/events/$1/purchases"; cat "$J/last.json"; echo; }
   last()   { node "$J/h.mjs" json "$1" < "$J/last.json"; }
   api_ticket(){ curl -s -H "X-Api-Key: $KEY" "$API/api/partner/tickets/$1"; echo; }
   api_event(){ curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events" | node "$J/h.mjs" event "$1"; }
   vt() { local p="${COMPOSE_PROJECT_NAME:-catraca}-gates"; docker compose -p "$p" -f compose.gates.yaml run --rm --build gates npx vitest run --reporter=verbose "$@"; local s=$?; docker compose -p "$p" -f compose.gates.yaml down -v --remove-orphans >/dev/null 2>&1; return $s; }
   login orgA org.a@catraca.dev; login orgB org.b@catraca.dev; login ps participante@catraca.dev
   ```
   Se `new_event` não imprimir o id, o id é o do link `/org/events/evt_…` do nome único em `GET /org/events`.
5. Testes vitest: o nome começa pelo ID do item. `vt test/f08/<arquivo> -t "C-F08-nn"` roda só os testes do item. A evidência é a linha `✓ … C-F08-nn …` e `Tests  N passed` sem `failed`. Se F01 tiver um atalho equivalente documentado, ele também vale.
6. Estado inicial: a seed (org A, org B, participante; senha `catraca123`) e a chave `catraca-parceiro-2026`. Nomes e e-mails são únicos por execução, então nenhum item exige banco vazio.

## Itens verificáveis

### Gates e fluxo do avaliador

- **C-F08-01:** gates verdes, incluindo os testes de F08 e o fluxo em escala reduzida.
  - **Como:** `npm run gates; echo "exit=$?"`
  - **Esperado:** `exit=0`. Lint e typecheck passam sem erros, e `test/f08/*.test.ts` (inclusive `flow.integration.test.ts`) roda sem falha. Nenhum container `*-gates` fica rodando (`docker ps`).
- **C-F08-02:** `npm run flow` passa contra o produto no ar, em escala 1, duas vezes seguidas.
  - **Como:** com o produto de pé (pré-requisito 2): `time npm run flow; echo "exit=$?"; npm run flow; echo "exit=$?"`
  - **Esperado:**
    - Cada execução imprime, nesta ordem, `PASS pré-checagem`, as 15 linhas `PASS passo 2 — …` a `PASS passo 16 — …` e `FLOW OK — passos 2–16 (escala 1) em T s`, com `exit=0`.
    - Nenhuma linha `FAIL`.
    - O tempo de cada execução é ≥ 90 s, por causa das esperas reais de 45 s dos passos 8 e 14.
    - Os asserts de cada passo são os da spec §8, entre eles:
      - passo 5, `pendente` → `confirmado` em ≤ 5 s;
      - passo 7, `409 {"error":"sold_out"}` e `Ingressos esgotados` antes de 30 s;
      - passo 8, `declined` e `availableSeats 1`;
      - passo 9, o painel `3/0/0/0/R$ 350,00/0`;
      - passo 10, as 4 mensagens de R10;
      - passo 11, `404`/`403`/`302` sem dados de E1;
      - passo 13, `404 event_not_available` e `refunded`/`cancelled` em ≤ 10 s;
      - passo 14, `Evento cancelado` e o painel `0/0/0/0/R$ 0,00/1`;
      - passo 15, `5 × 202` e `25 × 409` em E4 e em E5, com o painel `confirmed=5`/`available=0` em ≤ 10 s;
      - passo 16, `401`, `422` e `404`.
- **C-F08-03:** o fluxo falha de verdade (sai na primeira falha, com código ≠ 0).
  - **Como:** `KEY=chave-errada npm run flow; echo "exit=$?"`
  - **Esperado:** imprime `PASS pré-checagem`, depois `FAIL passo 2 — …` mencionando `401`. Nenhuma linha `PASS passo 3` ou posterior aparece, e o resultado é `exit=1`.
- **C-F08-04:** o fluxo em escala reduzida dentro dos gates.
  - **Como:** `vt test/f08/flow.integration.test.ts -t "C-F08-04"`
  - **Esperado:** o teste passa. `runFlow({ scale: 0.1 })` contra a app em porta efêmera, com o dispatcher local em `SimulatedGateway({ scale: 0.1 })`, devolve `ok: true` com os passos 2–16.

### Serviço de cancelamento

- **C-F08-05:** transições de R11.
  - **Como:** `vt test/f08/cancel.service.test.ts -t "C-F08-05"`
  - **Esperado:** o teste passa. O evento publicado tem tickets `confirmed` (×2, um com check-in), `pending` (×1), `declined` (×1) e `refunded` (×1). Logo depois de `cancelEvent(dono, id)`, que devolve `{ ok: true }`, sem espera:
    - o evento fica `status='cancelled'`, com `cancelled_at` não nulo;
    - os 2 confirmados ficam `refunded`, e o `checked_in_at` do que tinha check-in é preservado;
    - o pendente fica `cancelled`;
    - o recusado e o estornado não mudam.
- **C-F08-06:** só um evento publicado do próprio dono pode ser cancelado.
  - **Como:** `vt test/f08/cancel.service.test.ts -t "C-F08-06"`
  - **Esperado:** o teste passa. `cancelEvent` devolve:
    - `not_cancellable` para evento `draft` e para evento já `cancelled`;
    - `not_found` para id inexistente e para evento de outro organizador.

    Em todos os casos, nenhuma linha de `events`/`tickets` muda: o teste compara um snapshot antes e depois.
- **C-F08-07:** inspeção da transação.
  - **Como:** `grep -nE "lockEvent|withTransaction|UPDATE tickets|CASE status|WHEN 'confirmed' THEN 'refunded'|WHEN 'pending' THEN 'cancelled'" src/cancel/service.ts; grep -c "UPDATE tickets" src/cancel/service.ts`
  - **Esperado:**
    - `cancelEvent` usa `withTransaction` e `lockEvent`.
    - Existe **um único** `UPDATE tickets` (a contagem imprime `1`), com `CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled'`.
- **C-F08-08:** corrida entre o cancelamento e 20 respostas simultâneas do gateway (AC-F08-02).
  - **Como:** `vt test/f08/cancel.race.test.ts -t "C-F08-08"`
  - **Esperado:** o teste passa nas 20 rodadas. Em cada uma, `Promise.all` roda o cancelamento e 20 `applyGatewayResult` (aprovado/recusado aleatório, ordem embaralhada). Ao final:
    - o evento está `cancelled`;
    - há **0** tickets `confirmed` e **0** `pending`;
    - `refunded + cancelled + declined = 20`;
    - nenhuma exceção ocorre (sem deadlock).

### Rota, página de gestão e acesso

- **C-F08-10:** botão, aviso e cancelamento pela rota.
  - **Como:** `vt test/f08/cancel.routes.test.ts -t "C-F08-10"`
  - **Esperado:** o teste passa.
    - A página de gestão de um evento `published` contém `action="/org/events/<id>/cancel"` e o texto `Cancelar evento`. A de um evento `draft`, não.
    - O `POST /org/events/<id>/cancel` do dono responde `303` com `Location: /org/events/<id>`.
    - Depois disso, a página contém `Evento cancelado` e não contém `Cancelar evento`.
- **C-F08-11:** cancelamento rejeitado.
  - **Como:** `vt test/f08/cancel.routes.test.ts -t "C-F08-11"`
  - **Esperado:** o teste passa. O POST de cancelamento de um evento `draft` e de um já `cancelled` responde `409` com a página de gestão e `data-cancel-error`. O status do evento e dos tickets não muda.
- **C-F08-12:** dono, outro organizador, participante e visitante.
  - **Como:** `vt test/f08/cancel.routes.test.ts -t "C-F08-12"`
  - **Esperado:** o teste passa. O POST de cancelamento do evento de A responde:
    - para o org B, `404`, num corpo sem o nome do evento;
    - para o participante, `403`;
    - para o visitante, `302` com `Location` começando por `/login`.

    Nos três casos, o evento continua `published` e os tickets não mudam.

### Cross-feature (testes)

- **C-F08-09:** XC-F08-F03-01, resposta atrasada do gateway.
  - **Como:** `vt test/f08/cancel.cross.test.ts -t "C-F08-09"`
  - **Esperado:** o teste passa. Com o dispatcher local em escala 0,01, há duas compras: T5 com `4000000000000003` e T6 com `4000000000000001`. Quando T6 fica `confirmed`, o evento é cancelado. Depois de `dispatcher.idle()`:
    - T5 está `cancelled`, e o `payments` de T5 está `state='done'`, `result='approved'`;
    - T6 está `refunded`;
    - uma nova chamada `applyGatewayResult(T5, 'approved')` devolve `false` e não muda nada.
- **C-F08-13:** XC-F08-F04-01 com AC-F08-03, AC-F08-04 e AC-F08-07: o evento cancelado em F04.
  - **Como:** `vt test/f08/cancel.cross.test.ts -t "C-F08-13"`
  - **Esperado:** o teste passa. Depois do cancelamento:
    - `GET /` não contém o nome nem o id do evento, e `GET /events/<id>` responde `404`.
    - A página de gestão não tem `name="capacity"` nem `action="/org/events/<id>/publish"`.
    - `POST /org/events/<id>` (edição com outro nome, lotação e preço) e `POST /org/events/<id>/publish` respondem com status que não é `5xx`. A rejeição é verificada pelo efeito: `name`, `capacity`, `price_cents` e `status='cancelled'` ficam iguais no banco.
    - `getSeatCounts(id).available === 0` e `listOnSaleEvents()` não contém o evento.
- **C-F08-14:** XC-F08-F05-01 com AC-F08-03: compras e "Meus ingressos".
  - **Como:** `vt test/f08/cancel.cross.test.ts -t "C-F08-14"`
  - **Esperado:** o teste passa. Depois do cancelamento:
    - `purchaseTicket` nos canais `web` e `partner` devolve `{ ok: false, error: 'event_not_available' }`.
    - O `POST /events/<id>/purchase` do participante responde `404`, sem nova linha em `tickets`.
    - O `GET /me/tickets` do participante mostra o ticket antes confirmado com `data-ticket-status="refunded"` e o texto `estornado`, e o antes pendente com `data-ticket-status="cancelled"` e o texto `cancelado`.
- **C-F08-15:** XC-F08-F06-01: API de parceiros.
  - **Como:** `vt test/f08/cancel.cross.test.ts -t "C-F08-15"`
  - **Esperado:** o teste passa. Depois do cancelamento (`app.inject` com `X-Api-Key`):
    - `GET /api/partner/events` não contém o id;
    - `POST /api/partner/events/<id>/purchases` com corpo válido responde `404` com `{"error":"event_not_available"}`;
    - `GET /api/partner/tickets/<confirmado>` responde `200` com `status:"refunded"`, e o do pendente, com `status:"cancelled"`.
- **C-F08-16:** XC-F08-F06-02: `checkedIn` da API reflete o check-in de F07.
  - **Como:** `vt test/f08/cancel.cross.test.ts -t "C-F08-16"`
  - **Esperado:** o teste passa. Um ingresso comprado pela API e confirmado mostra `GET /api/partner/tickets/<id>` → `{"ticketId":…,"code":…,"eventId":…,"status":"confirmed","checkedIn":false}`. Depois do `POST /org/events/<id>/checkin` com o código, que mostra `Entrada liberada`, a mesma consulta mostra `"checkedIn":true` e `"status":"confirmed"`.
- **C-F08-17:** XC-F08-F07-01: check-in e painel depois do cancelamento.
  - **Como:** `vt test/f08/cancel.cross.test.ts -t "C-F08-17"`
  - **Esperado:** o teste passa. O evento tem 2 confirmados (um com check-in) e 1 pendente, e é cancelado. Depois disso:
    - o check-in pela rota com o código do confirmado sem check-in mostra `data-checkin-result` = `Evento cancelado`;
    - um código inexistente mostra `Ingresso inválido para este evento`;
    - o painel mostra `confirmed=0 | pending=0 | checkins=0 | available=0 | revenue=R$ 0,00 | refunded=2`.

### Ao vivo (produto no ar, escala 1)

- **C-F08-18:** XC-F08-F06-02 ao vivo: `checkedIn` false → true.
  - **Como:**
    ```bash
    X=$(new_event orgA "F08 CheckedIn $TS" 2 "30,00"); publish orgA "$X"
    api_buy "$X" "x-$TS@example.com" 4000000000000001; TX=$(last ticketId); CX=$(last code)
    sleep 6; api_ticket "$TX"
    checkin orgA "$X" "$CX"
    api_ticket "$TX"
    ```
  - **Esperado:**
    - `api_buy` imprime `202 {"ticketId":"tkt_…","code":"…","status":"pending"}`.
    - A primeira consulta imprime `{"ticketId":"$TX","code":"$CX","eventId":"$X","status":"confirmed","checkedIn":false}`.
    - O check-in imprime `Entrada liberada`.
    - A segunda consulta imprime o mesmo objeto com `"checkedIn":true` e `"status":"confirmed"`.
- **C-F08-19:** XC-F08-F05-01 e XC-F08-F03-01 ao vivo: a compra pela vitrine, o cancelamento e a resposta atrasada.
  - **Como:**
    ```bash
    signup q "q-$TS@example.com"
    Y=$(new_event orgA "F08 Web $TS" 5 "40,00"); publish orgA "$Y"
    buy q "$Y" 4000000000000003; T0=$(date +%s); buy q "$Y" 4000000000000001
    sleep 6; tickets q
    cancel orgA "$Y"; sleep 1; tickets q
    curl -s -b "$J/q" "$WEB/me/tickets" | grep -oE 'estornado|cancelado' | sort | uniq -c
    buy q "$Y" 4000000000000001
    S=$(( 45 - ($(date +%s) - T0) )); [ "$S" -gt 0 ] && sleep "$S"; tickets q
    ```
  - **Esperado:**
    - Depois de 6 s, um ticket está `confirmed` e outro `pending`.
    - `cancel` imprime `303 …/org/events/$Y`.
    - Logo depois (≤ 10 s), um ticket está `refunded` e outro `cancelled`, e o `uniq -c` mostra `1 cancelado` e `1 estornado`.
    - A nova compra imprime `404`.
    - Passados 45 s da compra com `0003`, o resultado continua o mesmo: um `refunded` e um `cancelled`.
- **C-F08-20:** AC-F08-01 e AC-F08-06 ao vivo: quem pode cancelar o quê.
  - **Como:**
    ```bash
    Z=$(new_event orgA "F08 Dono $TS" 3 "10,00")
    page orgA "$Z" | node "$J/h.mjs" has "Cancelar evento"; cancel orgA "$Z"
    publish orgA "$Z"; page orgA "$Z" | node "$J/h.mjs" has "Cancelar evento"
    cancel orgB "$Z"; cancel ps "$Z"; curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -d '' "$WEB/org/events/$Z/cancel"
    api_event "$Z"
    cancel orgA "$Z"; cancel orgA "$Z"
    ```
  - **Esperado:**
    - Em rascunho, `has` imprime `NAO` e `cancel` imprime `409` (sem redirect).
    - Depois de publicar, `has` imprime `SIM`.
    - org B → `404`; participante → `403`; visitante → `302 …/login…`.
    - `api_event` ainda mostra o evento, com `"availableSeats":3`, o que prova que as tentativas não alteraram nada.
    - O dono → `303 …/org/events/$Z`; de novo → `409`.
- **C-F08-21:** AC-F08-04 e XC-F08-F04-01 ao vivo: o evento cancelado não é editado nem republicado e sai da vitrine e da API.
  - **Como:** depois de C-F08-20, com `$Z` cancelado:
    ```bash
    page orgA "$Z" > "$J/z.html"
    for s in 'name="capacity"' "/org/events/$Z/publish" "Cancelar evento" "Evento cancelado"; do printf '%s: ' "$s"; node "$J/h.mjs" has "$s" < "$J/z.html"; done
    edit orgA "$Z" "Editado $TS" 50 "99,00"; publish orgA "$Z"
    page orgA "$Z" | node "$J/h.mjs" has "Editado $TS"; page orgA "$Z" | node "$J/h.mjs" has "F08 Dono $TS"
    api_event "$Z"; curl -s -o /dev/null -w '%{http_code}\n' "$WEB/events/$Z"; curl -s "$WEB/" | node "$J/h.mjs" has "$Z"
    panel orgA "$Z"
    ```
  - **Esperado:**
    - O laço imprime `name="capacity": NAO`, `/org/events/…/publish: NAO`, `Cancelar evento: NAO` e `Evento cancelado: SIM`.
    - `edit` e `publish` imprimem um código que não é `5xx`.
    - A rejeição se vê pelo efeito: depois, `Editado …` → `NAO` e `F08 Dono …` → `SIM`.
    - `api_event` → `ausente`, `/events/$Z` → `404` e a vitrine `has $Z` → `NAO`.
    - O painel mostra `available=0` e `revenue=R$ 0,00`.

## Mapeamento PRD → contrato

- AC-F08-01 → C-F08-10, C-F08-11, C-F08-20, C-F08-02
- AC-F08-02 → C-F08-05, C-F08-07, C-F08-08, C-F08-02
- AC-F08-03 → C-F08-13, C-F08-14, C-F08-19, C-F08-21, C-F08-02
- AC-F08-04 → C-F08-13, C-F08-21, C-F08-02
- AC-F08-05 → C-F08-08, C-F08-09, C-F08-19, C-F08-02
- AC-F08-06 → C-F08-06, C-F08-12, C-F08-20
- AC-F08-07 → C-F08-13, C-F08-17, C-F08-21, C-F08-02
- XC-F08-F03-01 → C-F08-09, C-F08-19, C-F08-02
- XC-F08-F04-01 → C-F08-13, C-F08-21, C-F08-02
- XC-F08-F05-01 → C-F08-14, C-F08-19
- XC-F08-F06-01 → C-F08-15, C-F08-02
- XC-F08-F06-02 → C-F08-16, C-F08-18
- XC-F08-F07-01 → C-F08-17, C-F08-02
