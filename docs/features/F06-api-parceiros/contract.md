# Contrato — F06 API de parceiros

> O avaliador verifica **exatamente** os itens abaixo, com evidência real (comando, status HTTP e corpo JSON). Referências: [spec](spec.md), [brief, "API de parceiros (contrato fixo)"](../../brief.md), [PRD §5 F06, §6 e §8](../../PRD.md).
> F06 roda em paralelo com F07 e **não** depende dela: `checkedIn: true` é verificado por fixture (C-F06-07). Os itens de tempo real rodam contra o produto no ar com `GATEWAY_DELAY_SCALE=1` (default).
> Nos exemplos, `<E>`, `<T>`, `<C>`, `<RUN>` e `<DAY>` são os valores reais da sessão. Os corpos JSON têm **exatamente** as chaves mostradas, nesta ordem, sem espaços.

## Pré-requisitos de ambiente

1. Worktree da branch `feat/F06-api-parceiros` com F01–F05 integradas (F07 pode ou não estar na `main`; nenhum item depende dela). Docker, Git e Node.js LTS no host (o Node só calcula datas e lê JSON; não precisa de `jq`).
2. Ambiente isolado e produto no ar com a seed:
   ```bash
   export COMPOSE_PROJECT_NAME=catraca-f06 CATRACA_PORT=3106
   npm run down; npm run up          # só retorna com /healthz 200 e seed carregada
   ```
3. Variáveis e helpers de shell (colar uma vez na sessão):
   ```bash
   export WEB="http://localhost:$CATRACA_PORT" API="http://localhost:$CATRACA_PORT" KEY="catraca-parceiro-2026"
   J=$(mktemp -d); RUN=$(date +%s)
   DAY=$(node -e 'console.log(new Date(Date.now()+20*864e5).toISOString().slice(0,10))')   # data futura (20 dias)
   login()   { curl -s -o /dev/null -c "$J/$1" --data-urlencode "email=$2" -d "password=catraca123" "$WEB/login"; }
   signup()  { curl -s -o /dev/null -c "$J/$1" --data-urlencode "name=$2" --data-urlencode "email=$3" -d "password=catraca123" "$WEB/signup"; }
   mkevent() { curl -s -o /dev/null -w '%{redirect_url}' -b "$J/orgA" --data-urlencode "name=$1" --data-urlencode "venue=Bar do Teste" \
                 -d "startsAt=${DAY}T20:00" -d "capacity=$2" --data-urlencode "price=$3" "$WEB/org/events/new" | grep -o 'evt_[a-z0-9]\{10\}'; }
   publish() { curl -s -o /dev/null -w '%{http_code}\n' -b "$J/orgA" -d '' "$WEB/org/events/$1/publish"; }
   buy()     { curl -s -o "$J/last.html" -w '%{http_code}\n' -b "$J/$1" -d "cardNumber=$3" "$WEB/events/$2/purchase"; }        # compra pela vitrine
   rows()    { curl -s -b "$J/$1" "$WEB/me/tickets" | grep -o '<tr data-ticket-id="[^"]*" data-ticket-code="[^"]*" data-ticket-status="[^"]*"'; }
   api()     { curl -s -w '\n%{http_code}\n' -H "X-Api-Key: $KEY" "$@"; }                       # imprime o corpo e, na linha seguinte, o status
   buyapi()  { api -X POST "$API/api/partner/events/$1/purchases" -H 'Content-Type: application/json' -d "{\"buyerEmail\":\"$2\",\"cardNumber\":\"$3\"}"; }
   field()   { node -e 'const b=require("fs").readFileSync(0,"utf8").split("\n")[0];console.log(JSON.parse(b)[process.argv[1]])' "$1"; }
   item()    { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const e=d.find(x=>x.id===process.argv[1]);console.log(e?JSON.stringify(e):"ausente")' "$1"; }
   seats()   { curl -s -H "X-Api-Key: $KEY" "$API/api/partner/events" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const e=d.find(x=>x.id===process.argv[1]);console.log(e?e.availableSeats:"ausente")' "$1"; }
   vt()      { npm run gates -- "$@" --reporter=verbose; }                                     # teste nomeado via gates (F01 D6)
   login orgA org.a@catraca.dev
   ```
   - Os eventos são criados **pela UI via curl** (login do organizador A + `POST /org/events/new` + `POST /org/events/<id>/publish`, de F04). `mkevent` extrai o id do `Location` do `303`.
   - `vt` roda um teste nomeado no container dos gates (Postgres efêmero, `npx vitest run <args>`), e o próprio `gates.sh` derruba o projeto `-gates` no fim. Esperado de cada item `vt`: código de saída 0 e o teste listado como `✓` na saída `verbose`.
4. Estado inicial: o banco pode ter dados de execuções anteriores. Cada item cria eventos e contas novos (sufixo `$RUN`) e procura o seu evento por id na listagem.
5. Ao final: `npm run down`.

## Itens verificáveis

### Testes automatizados

- **C-F06-01 — Gates verdes com os testes de F06.**
  Como verificar: `npm run gates`.
  Esperado: código de saída 0; o vitest lista os 8 arquivos `test/f06/auth.test.ts`, `events.test.ts`, `purchases.test.ts`, `robustness.test.ts`, `tickets.test.ts`, `integration.test.ts`, `burst.test.ts` e `gateway.test.ts`, todos passando; nenhum container `catraca-f06-gates*` fica de pé.

- **C-F06-02 — Autenticação antes de tudo.**
  Como verificar: `vt test/f06/auth.test.ts -t "as três rotas sem X-Api-Key ou com chave errada respondem 401 unauthorized"` e `vt test/f06/auth.test.ts -t "a chave é checada antes do parsing: corpo malformado sem chave dá 401"`.
  Esperado: os dois passam. As 3 rotas × (sem cabeçalho, chave errada, chave vazia, chave com 1 caractere a mais) → 401 com corpo exatamente `{"error":"unauthorized"}`; POST sem chave com corpo `{oops` e `Content-Type: text/plain` → 401 (não 422/415).

- **C-F06-03 — Chave correta e rota desconhecida.**
  Como verificar: `vt test/f06/auth.test.ts -t "chave correta passa e o cabeçalho não diferencia maiúsculas"` e `vt test/f06/auth.test.ts -t "rota desconhecida sob /api/partner: 401 sem chave e 404 JSON com chave"`.
  Esperado: os dois passam. Com `x-api-key` minúsculo e a chave certa, `GET /api/partner/events` → 200; `GET /api/partner/xyz` → 401 `{"error":"unauthorized"}` sem chave e 404 `{"error":"not_found"}` com chave, ambos JSON.

- **C-F06-04 — Listagem (fixtures).**
  Como verificar: `vt test/f06/events.test.ts -t "lista só eventos published com exatamente id, name, startsAt, priceCents e availableSeats"`, `vt test/f06/events.test.ts -t "availableSeats segue R05: pending e confirmed ocupam, declined não"` e `vt test/f06/events.test.ts -t "evento cancelled por fixture não aparece na listagem"`.
  Esperado: os três passam. Só o `published` aparece (nem `draft` nem `cancelled`); cada item tem exatamente as chaves `id,name,startsAt,priceCents,availableSeats`, com `id`/`name`/`startsAt` string e `priceCents`/`availableSeats` inteiros; `startsAt` casa com `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$`; lotação 5 com 1 `pending`, 1 `confirmed`, 1 `declined` e 1 `cancelled` → `availableSeats: 3`.

- **C-F06-05 — Compra e ordem de erros (fixtures).**
  Como verificar: `vt test/f06/purchases.test.ts -t "compra válida responde 202 com exatamente ticketId, code e status pending"`, `vt test/f06/purchases.test.ts -t "ordem de erros da compra: 422 antes de 404 antes de 409"` e `vt test/f06/purchases.test.ts -t "evento cancelled por fixture: compra responde 404 event_not_available"`.
  Esperado: os três passam. 202 com chaves exatamente `ticketId,code,status` e `status: "pending"`, ingresso gravado com `channel='partner'` e `user_id IS NULL`; corpo inválido + evento inexistente → 422; corpo inválido + evento lotado → 422; corpo válido + `draft`/`cancelled`/inexistente → 404 `{"error":"event_not_available"}`; corpo válido + lotado → 409 `{"error":"sold_out"}`; nenhum ingresso criado nos erros.

- **C-F06-06 — Robustez aos defaults do framework.**
  Como verificar: `vt test/f06/robustness.test.ts -t "corpos inválidos respondem 422 invalid_request e nunca 400, 415 ou 500"` e `vt test/f06/robustness.test.ts -t "ids em formato inesperado respondem 404 com o erro da rota"`.
  Esperado: os dois passam. JSON malformado, corpo vazio, `null`, `[]`, `"texto"`, `42`, `cardNumber` numérico, `buyerEmail` numérico, campo ausente, `Content-Type` ausente, `text/plain` ou `application/x-www-form-urlencoded`, e corpo de 20 KiB → 422 `{"error":"invalid_request"}`. Nenhum caso dá 400, 415 ou 500. `eventId` `evt_%00`, `%27%20OR%201%3D1--`, 300 caracteres e `EVT_ABCDEFGHIJ` → 404 `{"error":"event_not_available"}`; os mesmos formatos em `ticketId` → 404 `{"error":"ticket_not_found"}`.

- **C-F06-07 — Consulta de ingresso e `checkedIn` (fixtures, sem F07).**
  Como verificar: `vt test/f06/tickets.test.ts -t "consulta devolve exatamente ticketId, code, eventId, status e checkedIn"`, `vt test/f06/tickets.test.ts -t "checkedIn reflete tickets.checked_in_at da fixture insertTicket"`, `vt test/f06/tickets.test.ts -t "status da consulta usa os valores da API para os 5 status"` e `vt test/f06/tickets.test.ts -t "ingresso inexistente responde 404 ticket_not_found"`.
  Esperado: os quatro passam. Chaves exatamente `ticketId,code,eventId,status,checkedIn`, com `checkedIn` boolean; `insertTicket({ status: 'confirmed', checkedIn: true })` → `"status":"confirmed","checkedIn":true`, e sem `checkedIn` → `false`; os 5 status saem como `pending`/`confirmed`/`declined`/`cancelled`/`refunded`; `tkt_` inexistente → 404 `{"error":"ticket_not_found"}`.

- **C-F06-08 — XC-F06-F04-01 (automatizado, pela UI).**
  Como verificar: `vt test/f06/integration.test.ts -t "XC-F06-F04-01: evento criado pela UI só aparece depois de publicado, com preço, data e lotação da UI"`.
  Esperado: passa. O rascunho criado por `POST /org/events/new` (preço `100,00`, lotação 2, `startsAt` `<DAY>T20:00`) não aparece; depois do `POST /org/events/:id/publish`, aparece com `priceCents: 10000`, `startsAt: "<DAY>T20:00:00-03:00"` e `availableSeats: 2`.

- **C-F06-09 — XC-F06-F05-01 e XC-F06-F05-02 (automatizado).**
  Como verificar: `vt test/f06/integration.test.ts -t "XC-F06-F05-01: vitrine e API disputam as mesmas vagas"` e `vt test/f06/integration.test.ts -t "XC-F06-F05-02: ingresso da vitrine é consultável pela API com o mesmo code e status"`.
  Esperado: os dois passam. Lotação 2: 1 compra pela vitrine (303) + 1 pela API (202) → a próxima pela API responde 409 `{"error":"sold_out"}` e `GET /events/:id` contém `Ingressos esgotados`; o `ticketId` da compra pela vitrine, consultado na API, devolve o mesmo `code` e o mesmo `status` do `data-ticket-status` de `/me/tickets`.

- **C-F06-10 — Rajada HTTP automatizada.**
  Como verificar: `vt test/f06/burst.test.ts -t "30 POST simultâneos × 10 rodadas: exatamente 5 respostas 202 e 25 respostas 409"`.
  Esperado: passa. Em cada uma das 10 rodadas (evento novo, lotação 5): 5 × 202, 25 × 409 com `{"error":"sold_out"}` e 5 ingressos no banco.

- **C-F06-11 — Resultado do gateway pela API (escala 0,01).**
  Como verificar: `vt test/f06/gateway.test.ts -t "0001 fica confirmed e 0004 fica pending e depois declined liberando a vaga"`.
  Esperado: passa. `0001` → consulta `confirmed`; `0004` → `pending` com `availableSeats` reduzido em 1, depois `declined` com `availableSeats` de volta ao valor anterior.

### Produto no ar (escala 1)

- **C-F06-12 — 401 nas três rotas (passo 16).**
  Como verificar:
  ```bash
  for k in "" "X-Api-Key: chave-errada"; do
    curl -s -w ' %{http_code}\n' ${k:+-H "$k"} "$API/api/partner/events"
    curl -s -w ' %{http_code}\n' ${k:+-H "$k"} -X POST "$API/api/partner/events/evt_aaaaaaaaaa/purchases" -H 'Content-Type: application/json' -d '{"buyerEmail":"a@example.com","cardNumber":"4000000000000001"}'
    curl -s -w ' %{http_code}\n' ${k:+-H "$k"} "$API/api/partner/tickets/tkt_aaaaaaaaaa"
  done
  curl -s -w ' %{http_code}\n' -X POST "$API/api/partner/events/evt_aaaaaaaaaa/purchases" -H 'Content-Type: text/plain' -d '{oops'
  ```
  Esperado: 7 linhas, todas exatamente `{"error":"unauthorized"} 401`.

- **C-F06-13 — XC-F06-F04-01: rascunho fora, publicado dentro, com os valores da UI (passos 2 e 4).**
  Como verificar:
  ```bash
  E1=$(mkevent "Parceiro $RUN" 2 "100,00"); echo "$E1"
  item "$E1"
  publish "$E1"
  item "$E1"
  api "$API/api/partner/events" | tail -1
  ```
  Esperado: um id `evt_` + 10 caracteres; `ausente` (rascunho fora da listagem); `303`; exatamente `{"id":"<E1>","name":"Parceiro <RUN>","startsAt":"<DAY>T20:00:00-03:00","priceCents":10000,"availableSeats":2}`; `200`.

- **C-F06-14 — Compra válida → 202 (passo 6).**
  Como verificar:
  ```bash
  R=$(buyapi "$E1" ana-$RUN@example.com 4000000000000004); echo "$R"
  T2=$(echo "$R" | field ticketId); C2=$(echo "$R" | field code); seats "$E1"
  ```
  Esperado: primeira linha exatamente `{"ticketId":"<T2>","code":"<C2>","status":"pending"}`, com `<T2>` casando com `tkt_[a-z0-9]{10}` e `<C2>` com `[A-Z2-9]{8}`; segunda linha `202`; `seats` imprime `1`.

- **C-F06-15 — Consulta e `0001` confirmado em até 5 s (passo 8, AC-F06-07).**
  Como verificar (o laço começa imediatamente depois da compra):
  ```bash
  R=$(buyapi "$E1" bia-$RUN@example.com 4000000000000001); T3=$(echo "$R" | field ticketId); C3=$(echo "$R" | field code)
  api "$API/api/partner/tickets/$T3"
  for i in $(seq 1 10); do sleep 0.5; api "$API/api/partner/tickets/$T3" | head -1 | grep -q '"status":"confirmed"' && { echo "confirmed em <= $((i*5))00 ms"; break; }; done
  api "$API/api/partner/tickets/$T3"
  ```
  Esperado: primeira consulta `{"ticketId":"<T3>","code":"<C3>","eventId":"<E1>","status":"pending","checkedIn":false}` e `200`; o laço imprime `confirmed em <= N ms` com N ≤ 5000; última consulta exatamente `{"ticketId":"<T3>","code":"<C3>","eventId":"<E1>","status":"confirmed","checkedIn":false}` e `200`.

- **C-F06-16 — `0004`: pendente por 30–40 s, depois recusado, e a vaga volta (passos 6–8, AC-F06-07).**
  Como verificar (continua de C-F06-14; medir a partir da compra de `$T2`):
  ```bash
  E5=$(mkevent "Demora $RUN" 2 "40,00"); publish "$E5"
  R=$(buyapi "$E5" lenta-$RUN@example.com 4000000000000004); T=$(echo "$R" | field ticketId); seats "$E5"
  sleep 20; api "$API/api/partner/tickets/$T" | head -1; seats "$E5"
  sleep 25; api "$API/api/partner/tickets/$T" | head -1; seats "$E5"
  api "$API/api/partner/tickets/$T2" | head -1
  ```
  Esperado: `303`; `1`; aos ~20 s, `…"status":"pending","checkedIn":false}` e `1`; aos ~45 s, `…"status":"declined","checkedIn":false}` e `2` (vaga liberada); `$T2` (C-F06-14, comprado há > 45 s) também `"status":"declined"`.

- **C-F06-17 — Ordem de erros da compra (passos 7 e 16, AC-F06-04).**
  Como verificar:
  ```bash
  EF=$(mkevent "Cheio $RUN" 1 "10,00"); publish "$EF"; DR=$(mkevent "Rascunho API $RUN" 5 "10,00")
  buyapi "$EF" a-$RUN@example.com 4000000000000003            # ocupa a única vaga (pendente 30–40 s)
  buyapi "$EF" b-$RUN@example.com 4000000000000001            # sem vaga
  buyapi "$EF" b-$RUN@example.com 123                         # corpo inválido em evento lotado
  buyapi "$EF" sem-arroba.example.com 4000000000000001        # e-mail mal formado
  api -X POST "$API/api/partner/events/$EF/purchases" -H 'Content-Type: application/json' -d '{"cardNumber":"4000000000000001"}'   # campo faltando
  buyapi "$DR" b-$RUN@example.com 4000000000000001            # rascunho
  buyapi evt_naoexiste0 b-$RUN@example.com 4000000000000001   # inexistente
  buyapi evt_naoexiste0 b-$RUN@example.com 123                # corpo inválido em evento inexistente
  ```
  Esperado, na ordem (corpo e, na linha seguinte, status): `{"ticketId":"…","code":"…","status":"pending"}` `202`; `{"error":"sold_out"}` `409`; `{"error":"invalid_request"}` `422`; `{"error":"invalid_request"}` `422`; `{"error":"invalid_request"}` `422`; `{"error":"event_not_available"}` `404`; `{"error":"event_not_available"}` `404`; `{"error":"invalid_request"}` `422`.

- **C-F06-18 — Robustez: nunca 400/415/500 (AC-F06-08).**
  Como verificar (usa `$EF`, lotado, de C-F06-17: se algum corpo fosse aceito, a resposta seria 409, e não 422):
  ```bash
  P="$API/api/partner/events/$EF/purchases"; OK='{"buyerEmail":"x@example.com","cardNumber":"4000000000000001"}'
  api -X POST "$P" -H 'Content-Type: application/json' -d '{"buyerEmail":"x@example.com",'
  api -X POST "$P" -H 'Content-Type: application/json' -d '[]'
  api -X POST "$P" -H 'Content-Type: application/json' -d 'null'
  api -X POST "$P" -H 'Content-Type: application/json' -d '{"buyerEmail":"x@example.com","cardNumber":4000000000000001}'
  api -X POST "$P" -H 'Content-Type: application/json'
  api -X POST "$P" -H 'Content-Type:' -d "$OK"
  api -X POST "$P" -H 'Content-Type: text/plain' -d "$OK"
  api -X POST "$API/api/partner/events/evt_%00/purchases" -H 'Content-Type: application/json' -d "$OK"
  api -X POST "$API/api/partner/events/%27%20OR%201%3D1--/purchases" -H 'Content-Type: application/json' -d "$OK"
  api "$API/api/partner/tickets/%27%20OR%201%3D1--"
  api "$API/api/partner/tickets/$(printf 'x%.0s' $(seq 1 300))"
  ```
  Esperado: as 7 primeiras chamadas → `{"error":"invalid_request"}` `422` (JSON malformado, array, `null`, cartão numérico, corpo vazio, sem `Content-Type`, `text/plain`); as 2 seguintes → `{"error":"event_not_available"}` `404`; as 2 últimas → `{"error":"ticket_not_found"}` `404`. Nenhuma resposta 400, 415 ou 500.

- **C-F06-19 — Ingresso inexistente (passo 16).**
  Como verificar: `api "$API/api/partner/tickets/tkt_naoexiste0"`.
  Esperado: `{"error":"ticket_not_found"}` e `404`.

- **C-F06-20 — XC-F06-F05-01: vitrine e API disputam as mesmas vagas (passo 7).**
  Como verificar (sequência rápida: os cartões `0003` mantêm os ingressos pendentes por 30–40 s):
  ```bash
  EX=$(mkevent "Disputa $RUN" 2 "100,00"); publish "$EX"
  signup px "Participante X" "px-$RUN@example.com"
  buy px "$EX" 4000000000000003
  buyapi "$EX" parceiro1-$RUN@example.com 4000000000000003
  seats "$EX"
  buyapi "$EX" parceiro2-$RUN@example.com 4000000000000001
  curl -s -b "$J/px" "$WEB/events/$EX" | grep -o '<p data-sold-out>[^<]*</p>'
  ```
  Esperado: `303`; `{"ticketId":"…","code":"…","status":"pending"}` `202`; `0`; `{"error":"sold_out"}` `409`; `<p data-sold-out>Ingressos esgotados</p>`.

- **C-F06-21 — XC-F06-F05-02: ingresso da vitrine consultado pela API.**
  Como verificar:
  ```bash
  EY=$(mkevent "Consulta $RUN" 3 "100,00"); publish "$EY"
  signup py "Participante Y" "py-$RUN@example.com"
  buy py "$EY" 4000000000000003; rows py
  TP=$(rows py | grep -o 'tkt_[a-z0-9]\{10\}' | head -1); api "$API/api/partner/tickets/$TP"
  buy py "$EY" 4000000000000001; sleep 6; rows py
  TC=$(rows py | grep 'data-ticket-status="confirmed"' | grep -o 'tkt_[a-z0-9]\{10\}'); api "$API/api/partner/tickets/$TC"
  ```
  Esperado: `303`; 1 linha `data-ticket-id="<TP>" data-ticket-code="<X>" data-ticket-status="pending"`; a API devolve `{"ticketId":"<TP>","code":"<X>","eventId":"<EY>","status":"pending","checkedIn":false}` `200`. Depois, `303`; 2 linhas, uma com `data-ticket-status="confirmed"` e código `<Y>`; a API devolve `{"ticketId":"<TC>","code":"<Y>","eventId":"<EY>","status":"confirmed","checkedIn":false}` `200`. Mesmos `code` e `status` nos dois lados.

- **C-F06-22 — Comando literal do passo 15, em 5 eventos novos.**
  Como verificar (o bloco interno é o comando do brief, sem alteração):
  ```bash
  for n in 1 2 3 4 5; do
    E4=$(mkevent "Carga $n $RUN" 5 "10,00"); publish "$E4" >/dev/null; echo "rodada $n ($E4):"
    seq 30 | xargs -P 30 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
      -X POST "$API/api/partner/events/$E4/purchases" \
      -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
      -d '{"buyerEmail":"carga{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
    sleep 10; echo "availableSeats após 10 s: $(seats "$E4")"
  done
  ```
  Esperado: em **cada** uma das 5 rodadas, exatamente duas linhas de contagem, `5 202` e `25 409` (com o alinhamento do `uniq -c`), e nenhum outro status; em seguida, `availableSeats após 10 s: 0`.

- **C-F06-23 — Rajada com corpos: os 5 aceitos ficam `confirmed` em até 10 s.**
  Como verificar:
  ```bash
  EB=$(mkevent "Carga corpos $RUN" 5 "10,00"); publish "$EB" >/dev/null; B="$J/burst"; mkdir -p "$B"
  seq 30 | xargs -P 30 -I{} curl -s -o "$B/{}.json" -w "%{http_code}\n" -X POST "$API/api/partner/events/$EB/purchases" \
    -H "X-Api-Key: $KEY" -H "Content-Type: application/json" -d '{"buyerEmail":"corpo{}@example.com","cardNumber":"4000000000000001"}' | sort | uniq -c
  grep -l '"error":"sold_out"' "$B"/*.json | wc -l
  sleep 10
  for t in $(cat "$B"/*.json | grep -o 'tkt_[a-z0-9]\{10\}'); do api "$API/api/partner/tickets/$t" | head -1; done
  seats "$EB"
  ```
  Esperado: `5 202` e `25 409`; `25` (os 409 têm exatamente `{"error":"sold_out"}`); 5 linhas `{"ticketId":"tkt_…","code":"…","eventId":"<EB>","status":"confirmed","checkedIn":false}` com 5 `ticketId` e 5 `code` distintos; `0`.

- **C-F06-24 — Forma automatizada: `scripts/burst.sh`.**
  Como verificar: `scripts/burst.sh 5; echo "exit=$?"` (na mesma sessão, com `COMPOSE_PROJECT_NAME` e `CATRACA_PORT` exportados; o script cria cada evento publicado de lotação 5 no banco desse projeto e dispara o comando do passo 15 contra `$API`).
  Esperado: 5 linhas `Rodada <n> (evt_…): 5 x 202, 25 x 409 — OK`, para n = 1…5, cada uma com um `evt_…` diferente; nenhuma linha `FALHOU`; última linha `exit=0`.

## Mapeamento PRD → contrato

- AC-F06-01 → C-F06-02, C-F06-03, C-F06-12
- AC-F06-02 → C-F06-04, C-F06-13
- AC-F06-03 → C-F06-05, C-F06-14
- AC-F06-04 → C-F06-05, C-F06-17
- AC-F06-05 → C-F06-10, C-F06-22, C-F06-23, C-F06-24
- AC-F06-06 → C-F06-07, C-F06-15, C-F06-19
- AC-F06-07 → C-F06-11, C-F06-15, C-F06-16
- AC-F06-08 → C-F06-02, C-F06-06, C-F06-07, C-F06-14, C-F06-18
- XC-F06-F04-01 → C-F06-08, C-F06-13
- XC-F06-F05-01 → C-F06-09, C-F06-20
- XC-F06-F05-02 → C-F06-09, C-F06-21

Observações (fora do mapeamento):
- O item de gates (C-F06-01) sustenta todos os itens vitest acima.
- A integração F06 × F07 (`checkedIn: true` depois de um check-in real) não é aresta do grafo, porque as duas estão na mesma wave paralela. Ela é verificada pela integradora F08, no contrato dela.
- Neste contrato, `checkedIn` é verificado por fixture (`insertTicket({ checkedIn: true })`), no item de consulta de ingresso.
