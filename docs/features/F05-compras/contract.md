# Contrato — F05 Compras & Meus ingressos

> O avaliador verifica **exatamente** os itens abaixo, com evidência real (saída de comando, status + trecho de HTML). Referências: [spec](spec.md), [PRD §5 F05 e §6](../../PRD.md).
> Itens de tempo real rodam contra o produto no ar com `GATEWAY_DELAY_SCALE=1` (default). Os testes vitest usam escala reduzida ou dispatcher parado.

## Pré-requisitos de ambiente

1. Worktree da branch `feat/F05-compras` com F01–F04 já integradas. Docker, Git e Node.js LTS no host (o Node só é usado para calcular uma data).
2. Ambiente isolado e produto no ar com a seed:
   ```bash
   export COMPOSE_PROJECT_NAME=catraca-f05 CATRACA_PORT=3105
   npm run down; npm run up          # só retorna com /healthz 200 e seed carregada
   ```
3. Variáveis e helpers de shell (colar uma vez na sessão; todos os itens de `curl` os usam):
   ```bash
   export WEB="http://localhost:$CATRACA_PORT"
   J=$(mktemp -d); RUN=$(date +%s); : > "$J/anon"
   DAY=$(node -e 'console.log(new Date(Date.now()+20*864e5).toISOString().slice(0,10))')   # data futura (20 dias)
   login()   { curl -s -o /dev/null -c "$J/$1" --data-urlencode "email=$2" -d "password=catraca123" "$WEB/login"; }
   signup()  { curl -s -o /dev/null -c "$J/$1" --data-urlencode "name=$2" --data-urlencode "email=$3" -d "password=catraca123" "$WEB/signup"; }
   mkevent() { curl -s -o /dev/null -w '%{redirect_url}' -b "$J/orgA" --data-urlencode "name=$1" --data-urlencode "venue=Bar do Teste" \
                 -d "startsAt=${DAY}T20:00" -d "capacity=$2" --data-urlencode "price=$3" "$WEB/org/events/new" | grep -o 'evt_[a-z0-9]\{10\}'; }
   publish() { curl -s -o /dev/null -w '%{http_code}\n' -b "$J/orgA" -d '' "$WEB/org/events/$1/publish"; }
   edit()    { curl -s -o /dev/null -w '%{http_code}\n' -b "$J/orgA" --data-urlencode "name=$2" --data-urlencode "venue=Bar do Teste" \
                 -d "startsAt=${DAY}T20:00" -d "capacity=$3" --data-urlencode "price=$4" "$WEB/org/events/$1"; }
   buy()     { curl -s -o "$J/last.html" -w '%{http_code} %{time_total} %{redirect_url}\n' -b "$J/$1" -d "cardNumber=$3" "$WEB/events/$2/purchase"; }
   rows()    { curl -s -b "$J/$1" "$WEB/me/tickets" | grep -o '<tr data-ticket-id="[^"]*" data-ticket-code="[^"]*" data-ticket-status="[^"]*">.*</tr>'; }
   show()    { curl -s -b "$J/$1" "$WEB/events/$2"; }
   vt()      { npm run gates -- "$@" --reporter=verbose; }                                     # teste nomeado via gates (F01 D6)
   login orgA org.a@catraca.dev
   ```
   - `mkevent` depende de `POST /org/events/new` responder `303` com `Location: /org/events/<id>` (F04). `edit` envia o formulário completo de edição de F04.
   - `vt` roda um teste nomeado no container dos gates (Postgres efêmero, `npx vitest run <args>`), e o próprio `gates.sh` derruba o projeto `-gates` no fim. Esperado de cada item `vt`: código de saída 0 e o teste listado como `✓` na saída `verbose`.
4. Estado inicial: o banco do produto pode ter dados de execuções anteriores. Todos os itens criam eventos e contas novos (sufixo `$RUN`), então não dependem de banco vazio.
5. Ao final: `npm run down`.

## Itens verificáveis

### Testes automatizados

- **C-F05-01 — Gates verdes com os testes de F05.**
  Como verificar: `npm run gates`.
  Esperado: código de saída 0; a saída do vitest lista os 7 arquivos `test/f05/validation.test.ts`, `service.test.ts`, `concurrency.test.ts`, `gateway.test.ts`, `web-purchase.test.ts`, `my-tickets.test.ts` e `cross-feature.test.ts`, todos passando. Nenhum container `catraca-f05-gates*` fica de pé (`docker ps`).

- **C-F05-02 — Validação da entrada.**
  Como verificar: `vt test/f05/validation.test.ts -t "validatePurchaseInput aceita só e-mail bem formado e cartão string de 16 dígitos"`.
  Esperado: passa. O teste cobre `{ok:true}` para `ana@example.com` + `4000000000000001` e `{ok:false, error:'invalid_request'}` para: cartão `123`, 15 e 17 dígitos, com letras, com espaços, `null`, número `4000000000000001`, array; e-mail sem `@`, sem domínio, com espaço, ausente e com > 254 caracteres.

- **C-F05-03 — Ordem dos erros de `purchaseTicket`.**
  Como verificar: `vt test/f05/service.test.ts -t "ordem dos erros: invalid_request, event_not_available, sold_out"`.
  Esperado: passa. Cartão inválido em evento inexistente → `invalid_request`; corpo válido em evento inexistente, `draft` e `cancelled` (fixture), mesmo lotado → `event_not_available`; evento `published` lotado → `sold_out`; em nenhum dos casos surge linha nova em `tickets`.

- **C-F05-04 — Ingresso nasce pendente com o preço vigente.**
  Como verificar: `vt test/f05/service.test.ts -t "compra cria ingresso pending com price_cents do evento e pagamento requested"` e `vt test/f05/service.test.ts -t "mudança de preço posterior não altera o price_cents do ingresso"`.
  Esperado: os dois passam. Ingresso com `status='pending'`, `price_cents` = `events.price_cents` no momento da compra, `card_last4='0001'`, `id` no formato `tkt_…`; existe uma linha `payments` com `state='requested'` para ele; depois de `UPDATE events SET price_cents=15000`, o ingresso antigo continua com 10000 e uma nova compra grava 15000.

- **C-F05-05 — Pendente ocupa vaga.**
  Como verificar: `vt test/f05/service.test.ts -t "ingresso pendente ocupa vaga"`.
  Esperado: passa. Evento de lotação 1 com uma compra `pending` → `getSeatCounts().available === 0` e a próxima compra → `sold_out`.

- **C-F05-06 — Código único.**
  Como verificar: `vt test/f05/service.test.ts -t "código de 8 caracteres do alfabeto A-Z2-9 e nova tentativa em colisão"`.
  Esperado: passa. O código casa com `^[A-Z2-9]{8}$`; com o código `AAAAAAAA` já existente e o gerador devolvendo `AAAAAAAA` e depois `BBBBBBBB`, o ingresso fica com `BBBBBBBB` e o gerador é chamado 2 vezes.

- **C-F05-07 — Canal parceiro.**
  Como verificar: `vt test/f05/service.test.ts -t "canal partner sem userId conta na lotação"` e `vt test/f05/my-tickets.test.ts -t "ingresso partner com o mesmo e-mail do participante não aparece"`.
  Esperado: os dois passam. `purchaseTicket({channel:'partner', buyerEmail, cardNumber})` sem `userId` → ingresso com `user_id IS NULL`, `channel='partner'`, contado nas ocupadas; `GET /me/tickets` do participante com o mesmo e-mail não mostra esse código.

- **C-F05-08 — Exports e `kick` depois do commit.**
  Como verificar: `vt test/f05/service.test.ts -t "módulo de compras exporta a interface do architecture.md"` e `vt test/f05/service.test.ts -t "kick do dispatcher é chamado só em sucesso e depois do commit"`.
  Esperado: os dois passam. `purchaseTicket`, `validatePurchaseInput`, `findTicketById`, `findTicketByCode` e `listTicketsForUser` são funções exportadas de `src/purchases/service.ts`; `dispatcher.kick` é chamado 1 vez por compra `ok`, 0 vezes em erro; no momento da chamada, o ingresso já é visível por outra conexão do pool (já houve commit).

- **C-F05-09 — R07: 30 compras simultâneas × 20 rodadas.**
  Como verificar: `vt test/f05/concurrency.test.ts -t "R07: 30 compras simultâneas × 20 rodadas, lotação 5, ocupadas nunca passam de 5"`.
  Esperado: passa. O teste afirma `pool.options.max >= 31`; em **cada** uma das 20 rodadas (evento novo, lotação 5, 30 `purchaseTicket` em `Promise.all`): exatamente 5 `ok` e 25 `sold_out`; máximo de ocupadas amostrado durante a rajada ≤ 5; ocupadas finais = 5; 5 linhas em `tickets` e 5 em `payments`; 5 códigos distintos.

- **C-F05-10 — Controle negativo da prova.**
  Como verificar: `vt test/f05/concurrency.test.ts -t "controle: check-then-insert sem lock vende além da lotação"`.
  Esperado: passa. Isto é, a implementação ingênua escrita no teste (sem `lockEvent`) termina com **mais de 5** ocupadas num evento de lotação 5, o que mostra que a rajada gera concorrência real no banco.

- **C-F05-11 — A compra espera o lock do evento.**
  Como verificar: `vt test/f05/concurrency.test.ts -t "purchaseTicket espera o lockEvent de outra transação"`.
  Esperado: passa. Com outra transação segurando `lockEvent(evento)`, o `purchaseTicket` não resolve em 300 ms; depois do `COMMIT` dela, resolve `ok`.

- **C-F05-12 — Resultado do gateway (escala 0,01).**
  Como verificar: `vt test/f05/gateway.test.ts -t "0001 vira confirmed e 0002 vira declined liberando a vaga"`.
  Esperado: passa. `0001` → `confirmed`; `0002` → `declined`; num evento de lotação 1, `available` é 0 com o `0002` pendente e volta a 1 depois da recusa.

- **C-F05-13 — Guardas da compra.**
  Como verificar: `vt test/f05/web-purchase.test.ts -t "visitante é redirecionado para /login e organizador recebe 403"`.
  Esperado: passa. Visitante: `POST /events/:id/purchase` → 302 com `Location` começando por `/login?next=`; organizador → 403; nenhum ingresso criado.

- **C-F05-14 — Compra pela vitrine sem esperar o gateway.**
  Como verificar: `vt test/f05/web-purchase.test.ts -t "participante compra: 303 para /me/tickets em menos de 1 s, ingresso pending da sessão"`.
  Esperado: passa. Com cartão `4000000000000003`: 303, `Location: /me/tickets`, duração < 1000 ms; ingresso `pending`, `channel='web'`, `user_id` = id do participante logado, `buyer_email` = e-mail dele.

- **C-F05-15 — Cartão inválido na vitrine.**
  Como verificar: `vt test/f05/web-purchase.test.ts -t "cartão inválido: 422 com mensagem e nenhum ingresso criado"`.
  Esperado: passa. `cardNumber=123` → 422, HTML com `<p data-purchase-error>Número do cartão inválido: informe os 16 dígitos.</p>`; `count(*)` de `tickets` inalterado.

- **C-F05-16 — Evento indisponível na vitrine.**
  Como verificar: `vt test/f05/web-purchase.test.ts -t "evento draft, cancelled ou inexistente: 404 sem dados e nenhum ingresso"`.
  Esperado: passa. `draft` e `cancelled` (fixtures) e id inexistente → 404 cujo HTML não contém o nome nem o local do evento; nenhum ingresso criado.

- **C-F05-17 — `Ingressos esgotados` no lugar da compra e como resposta.**
  Como verificar: `vt test/f05/web-purchase.test.ts -t "sem vaga: Ingressos esgotados no lugar do formulário e POST responde 409"`.
  Esperado: passa. Evento lotado: `GET /events/:id` contém `<p data-sold-out>Ingressos esgotados</p>` e **não** contém `data-buy-form`; `POST /events/:id/purchase` → 409 com `Ingressos esgotados` e nenhuma linha nova. Evento com vaga: contém `data-buy-form` e não contém `data-sold-out`.

- **C-F05-18 — "Meus ingressos": conteúdo e isolamento.**
  Como verificar: `vt test/f05/my-tickets.test.ts -t "rótulos em português, código e nome do evento; só os do próprio participante"`.
  Esperado: passa. Com fixtures nos 5 status, cada `<tr data-ticket-status="pending|confirmed|declined|cancelled|refunded">` tem a célula `data-col="status"` com `pendente|confirmado|recusado|cancelado|estornado`, além do `data-col="code"` e do `data-col="event"` com o nome do evento; outro participante não vê nenhum desses códigos; sem ingressos → `data-my-tickets-empty`.

- **C-F05-19 — XC-F05-F04-01 (automatizado).**
  Como verificar: `vt test/f05/cross-feature.test.ts -t "XC-F05-F04-01: pendentes contam na redução de lotação da edição de F04"`.
  Esperado: passa. Lotação 2 com 2 compras `pending`: `POST /org/events/:id` com lotação 1 responde 422 (rejeição de F04) e `events.capacity` continua 2; com lotação 3 responde 303 e `capacity = 3`; uma nova compra pela vitrine responde 303.

### Produto no ar (escala 1)

- **C-F05-20 — Visitante não compra.**
  Como verificar:
  ```bash
  E=$(mkevent "Visita $RUN" 3 "100,00"); publish "$E"                 # 303
  show anon "$E" | grep -oE 'data-buy-login[^>]*>[^<]*|data-buy-form'
  buy anon "$E" 4000000000000001
  ```
  Esperado: `publish` imprime `303`; o `grep` mostra `data-buy-login href="/login?next=/events/<E>">Entre para comprar` e **não** mostra `data-buy-form`; `buy` imprime `302 …` com `redirect_url` terminando em `/login?next=%2Fevents%2F<E>%2Fpurchase` (ou `/login?next=/events/<E>/purchase`).

- **C-F05-21 — Compra pela vitrine: pendente, resposta < 1 s, "Meus ingressos".**
  Como verificar (cartão `0003`, que o gateway só responde em 30–40 s):
  ```bash
  E1=$(mkevent "Show Vitrine $RUN" 3 "100,00"); publish "$E1"
  signup p1 "Participante Um" "p1-$RUN@example.com"
  buy p1 "$E1" 4000000000000003
  rows p1
  ```
  Esperado: `buy` imprime `303 <t> $WEB/me/tickets` com `<t>` < `1.0`; `rows` imprime exatamente 1 linha com `data-ticket-id="tkt_…"`, `data-ticket-code="<8 caracteres [A-Z2-9]>"`, `data-ticket-status="pending"`, `<td data-col="event">Show Vitrine <RUN></td>` e `<td data-col="status">pendente</td>`.

- **C-F05-22 — Cartão inválido não cria ingresso.**
  Como verificar:
  ```bash
  buy p1 "$E1" 123; grep -o '<p data-purchase-error>[^<]*</p>' "$J/last.html"; rows p1 | wc -l
  ```
  Esperado: `422 …`; `<p data-purchase-error>Número do cartão inválido: informe os 16 dígitos.</p>`; `1` (nenhuma linha nova).

- **C-F05-23 — XC-F05-F03-01: `0001` confirmado em até 5 s.**
  Como verificar (rodar o laço **imediatamente** depois da compra):
  ```bash
  signup p2 "Participante Dois" "p2-$RUN@example.com"
  buy p2 "$E1" 4000000000000001; C=$(rows p2 | grep -o 'data-ticket-code="[A-Z2-9]\{8\}"' | cut -d'"' -f2); rows p2
  for i in $(seq 1 10); do sleep 0.5; rows p2 | grep -q "data-ticket-code=\"$C\" data-ticket-status=\"confirmed\"" && { echo "confirmado em <= $((i*5))00 ms"; break; }; done
  rows p2
  ```
  Esperado: `303 …`; a primeira listagem mostra `data-ticket-status="pending"` / `pendente`; o laço imprime `confirmado em <= N ms` com N ≤ 5000; a última listagem mostra `data-ticket-status="confirmed"` e `<td data-col="status">confirmado</td>` com o mesmo código `$C`.

- **C-F05-24 — Pendente ocupa vaga; `0002` recusa e libera a vaga (XC-F05-F03-01).**
  Como verificar:
  ```bash
  E2=$(mkevent "Recusa $RUN" 1 "30,00"); publish "$E2"
  signup p3 "Participante Três" "p3-$RUN@example.com"
  buy p3 "$E2" 4000000000000002
  show p3 "$E2" | grep -c 'data-sold-out'; show p3 "$E2" | grep -c 'data-buy-form'
  for i in $(seq 1 10); do sleep 0.5; rows p3 | grep -q 'data-ticket-status="declined"' && { echo "recusado em <= $((i*5))00 ms"; break; }; done
  rows p3; show p3 "$E2" | grep -c 'data-buy-form'
  ```
  Esperado: `303 …`; logo depois da compra, `1` (`Ingressos esgotados` presente: o pendente ocupa a única vaga) e `0` (sem formulário); o laço imprime `recusado em <= N ms` com N ≤ 5000; a linha mostra `data-ticket-status="declined"` e `recusado`; a última contagem é `1` (o formulário voltou: a vaga foi liberada).

- **C-F05-25 — Esgotado: no lugar do formulário e como resposta à tentativa (XC-F05-F04-02).**
  Como verificar:
  ```bash
  E3=$(mkevent "Lotado $RUN" 1 "50,00"); publish "$E3"
  signup p4 "Participante Quatro" "p4-$RUN@example.com"; signup p5 "Participante Cinco" "p5-$RUN@example.com"
  show p5 "$E3" | grep -c 'data-buy-form'                      # formulário aberto antes de esgotar
  buy p4 "$E3" 4000000000000003
  show p5 "$E3" | grep -o '<p data-sold-out>[^<]*</p>'; show p5 "$E3" | grep -c 'data-buy-form'
  buy p5 "$E3" 4000000000000001; grep -o 'Ingressos esgotados' "$J/last.html" | head -1; rows p5 | wc -l
  ```
  Esperado: `1`; `303 …`; `<p data-sold-out>Ingressos esgotados</p>` e `0`; `409 …`, `Ingressos esgotados` e `0` (p5 não ganhou ingresso).

- **C-F05-26 — Evento em rascunho não vende (XC-F05-F04-02).**
  Como verificar:
  ```bash
  D=$(mkevent "Rascunho $RUN" 5 "20,00")                        # não publicado
  curl -s -o /dev/null -w '%{http_code}\n' "$WEB/events/$D"
  buy p1 "$D" 4000000000000001; grep -c "Rascunho $RUN" "$J/last.html"; rows p1 | wc -l
  ```
  Esperado: `404`; `404 …`; `0` (nenhum dado do evento no corpo); `1` (nenhum ingresso novo para p1).

- **C-F05-27 — XC-F05-F04-01: pendentes contam na edição de lotação (produto no ar).**
  Como verificar (sequência rápida, terminar em menos de 30 s depois da primeira compra):
  ```bash
  E4=$(mkevent "Lotação $RUN" 2 "100,00"); publish "$E4"
  signup p6 "Participante Seis" "p6-$RUN@example.com"
  buy p6 "$E4" 4000000000000003; buy p6 "$E4" 4000000000000003     # 2 pendentes (30–40 s)
  edit "$E4" "Lotação $RUN" 1 "100,00"
  buy p6 "$E4" 4000000000000003
  edit "$E4" "Lotação $RUN" 3 "100,00"
  buy p6 "$E4" 4000000000000003
  ```
  Esperado: as duas primeiras compras `303 …`; a edição para 1 imprime `422` (rejeitada por F04: lotação menor que as 2 ocupadas); a compra seguinte `409 …` (a lotação continuou 2); a edição para 3 imprime `303`; a última compra `303 …`.

- **C-F05-28 — Isolamento de "Meus ingressos" e guarda de organizador (XC-F05-F02-01).**
  Como verificar:
  ```bash
  C1=$(rows p1 | grep -o 'data-ticket-code="[A-Z2-9]\{8\}"' | cut -d'"' -f2)
  login seed participante@catraca.dev
  curl -s -b "$J/seed" "$WEB/me/tickets" | grep -c "$C1"; curl -s -b "$J/p2" "$WEB/me/tickets" | grep -c "$C1"
  buy orgA "$E1" 4000000000000001
  curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$WEB/me/tickets"
  ```
  Esperado: `0` e `0` (nem o participante da seed nem p2 veem o código de p1); `403 …` (organizador não compra); `302 …/login?next=…` (visitante não acessa "Meus ingressos").

## Mapeamento PRD → contrato

- AC-F05-01 → C-F05-04, C-F05-14, C-F05-21
- AC-F05-02 → C-F05-02, C-F05-15, C-F05-22
- AC-F05-03 → C-F05-05, C-F05-24
- AC-F05-04 → C-F05-17, C-F05-25
- AC-F05-05 → C-F05-09, C-F05-10, C-F05-11
- AC-F05-06 → C-F05-06
- AC-F05-07 → C-F05-18, C-F05-21, C-F05-28
- AC-F05-08 → C-F05-04
- AC-F05-09 → C-F05-03, C-F05-16, C-F05-26
- AC-F05-10 → C-F05-07
- AC-F05-11 → C-F05-12, C-F05-24
- AC-F05-12 → C-F05-03, C-F05-08, C-F05-11
- XC-F05-F02-01 → C-F05-13, C-F05-14, C-F05-18, C-F05-20, C-F05-28
- XC-F05-F03-01 → C-F05-12, C-F05-23, C-F05-24
- XC-F05-F04-01 → C-F05-19, C-F05-27
- XC-F05-F04-02 → C-F05-16, C-F05-17, C-F05-25, C-F05-26

Observações (fora do mapeamento):
- O item de gates (C-F05-01) sustenta todos os itens vitest acima.
- O critério cross-feature de compras da API e da vitrine disputando as mesmas vagas pertence à aresta F05 → F06 e é coberto no contrato de F06, porque a API ainda não existe na W3.
- Em F05, a rajada de concorrência é verificada pelo teste de integração sobre `purchaseTicket` (30 promessas × 20 rodadas), não por HTTP.
