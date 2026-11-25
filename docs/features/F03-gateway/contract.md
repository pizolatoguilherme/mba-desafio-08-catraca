# Contrato — F03 Gateway simulado & Dispatcher

Contrato verificado pelo avaliador independente. Cada item diz **como verificar** e o **resultado esperado**. Um item só passa se o resultado observado for exatamente o esperado. Referência: [`spec.md`](spec.md).

## Pré-requisitos de ambiente

1. Máquina com Linux/macOS, Docker (Compose v2), Git, Node.js LTS e shell `bash`. Nenhum `npm install` no host.
2. Worktree na branch `feat/F03-gateway`, no commit avaliado (`git rev-parse HEAD`). A `main` contém F01 `done`. F02 e F04 **não** são necessárias.
3. Ambiente isolado e produto no modo padrão (escala 1, sem chave de pagamento). Rode na raiz da worktree:

```bash
export COMPOSE_PROJECT_NAME=catraca-f03 CATRACA_PORT=3103
unset GATEWAY_DELAY_SCALE GATEWAY_POLL_MS
npm run down; npm run up            # retorna 0 só com /healthz = 200 e a seed concluída
WEB="http://localhost:$CATRACA_PORT"
J=$(mktemp -d)                      # arquivos temporários da avaliação

# SQL no container do banco (o Postgres não é exposto no host)
sql()  { docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<<"$1"; }
# Script entregue por F03, executado dentro do container da app (usa o mesmo DATABASE_URL da app)
demo() { docker compose exec -T app node dist/gateway/enqueue-demo.js "$@"; }
# Extrai um campo das linhas JSON do demo (lidas do stdin)
jf()   { node -e 'const l=require("fs").readFileSync(0,"utf8").trim().split("\n").map(JSON.parse);console.log(l.map(x=>x[process.argv[1]]).join("\n"))' "$1"; }
# Resume um arquivo JSONL do demo: contagem por status e maior elapsedMs
summ() { node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);const s={};for(const x of l)s[x.status]=(s[x.status]||0)+1;console.log(l.length, JSON.stringify(s), Math.max(...l.map(x=>x.elapsedMs)))' "$1"; }
# Teste vitest nomeado via gates (F01 D6: `npm run gates -- <args>` roda `npx vitest run <args>` no container
# de gates, com Postgres efêmero, e derruba o projeto -gates ao final)
vt() { npm run gates -- "$1" -t "$2" --reporter=verbose; }
```

4. **Itens "vitest":** rode `vt <arquivo> "<nome>"`. O item passa quando o comando sai com código 0, a saída mostra `✓` na linha do teste com o nome indicado, o resumo tem ≥ 1 `passed` e nenhum `failed`, e a leitura do código do teste confirma que ele faz as asserções descritas no item.
5. **Itens "produto":** rodam contra a app subida no passo 3 (escala 1). Eles podem rodar em qualquer ordem, mas C-F03-16 reinicia a app, então rode-o por último entre os de produto. Os tempos medidos pelo banco (`requested_at`, `started_at`, `completed_at`) são a evidência principal; o `elapsedMs` do script é complementar.
6. No final: `npm run down`.

## Itens verificáveis

### C-F03-01 — `isValidCardNumber` e `cardLast4` (vitest)
- **Como:** `vt test/f03/card.test.ts "isValidCardNumber aceita exatamente 16 dígitos"`; `vt test/f03/card.test.ts "isValidCardNumber rejeita entradas inválidas"`; `vt test/f03/card.test.ts "cardLast4 devolve os 4 últimos dígitos"`.
- **Esperado:** os 3 testes passam. Eles afirmam:
  - `true` para `'4000000000000001'` e `'0000000000000000'`;
  - `false` para `'123'`, `'400000000000000'` (15), `'40000000000000011'` (17), `'400000000000000a'`, `''`, `' 4000000000000001'`, `'4000 0000 0000 0001'`, `null`, `undefined`, o número `4000000000000001` e dígitos de largura total (`'４０００００００００００００１'`);
  - `cardLast4('4000000000000004') === '0004'`.

### C-F03-02 — Tabela de `decide()` com `rnd` determinístico (vitest)
- **Como:** `vt test/f03/simulated.test.ts "decide aplica a tabela de finais com rnd nos extremos"`.
- **Esperado:** passa. O teste afirma, para `rnd = () => 0`, `() => 0.5` e `() => 0.9999999`, exatamente:
  - `0001` → `approved`, com 2000 / 3000 / 4000 ms;
  - `0002` → `declined`, com 2000 / 3000 / 4000 ms;
  - `0003` → `approved`, com 30000 / 35000 / 40000 ms;
  - `0004` → `declined`, com 30000 / 35000 / 40000 ms;
  - `0000`, `0005`, `1234`, `9999` → `declined`, com 2000 / 3000 / 4000 ms.

### C-F03-03 — `SimulatedGateway` em escala 1, medido (vitest)
- **Como:** `vt test/f03/simulated.test.ts "SimulatedGateway em escala 1 responde 0001 e 0002 entre 2 e 4 s medidos"`.
- **Esperado:** passa. O teste cria `new SimulatedGateway({ scale: 1 })` (rnd padrão), chama `authorize('0001')` e `authorize('0002')` em paralelo e afirma `approved` e `declined`, cada um com tempo medido (`performance.now()`) entre 1995 e 4100 ms.

### C-F03-04 — `GATEWAY_DELAY_SCALE` multiplica todos os atrasos (vitest)
- **Como:** `vt test/f03/simulated.test.ts "GATEWAY_DELAY_SCALE 0,01 faz o 0003 responder entre 300 e 400 ms"`; `vt test/f03/simulated.test.ts "a escala multiplica os atrasos de todos os finais"`; `vt test/f03/simulated.test.ts "SimulatedGateway rejeita escala inválida"`.
- **Esperado:** os 3 testes passam. Eles afirmam:
  - com `scale: 0.01`, `authorize('0003')` devolve `approved` em 295–450 ms (rnd padrão), em 295–360 ms com `rnd=()=>0` e em 395–460 ms com `rnd=()=>0.9999999`;
  - com `scale: 0.01` e `rnd=()=>0.5`: `0001`/`0002`/`0009` em 28–90 ms e `0003`/`0004` em 345–420 ms, com os resultados da tabela;
  - `scale` `-1`, `NaN` e `Infinity` lançam `RangeError`.

### C-F03-05 — Escala default 1 no produto (produto)
- **Como:** `docker compose exec -T app node -e 'import("./dist/config.js").then(m=>console.log(m.config.gatewayDelayScale, m.config.gatewayPollMs))'` e `grep -n "GATEWAY_DELAY_SCALE" compose.yaml || echo "ausente"`.
- **Esperado:** a primeira saída é exatamente `1 250`. A segunda saída é `ausente` ou uma linha com default `1` (ex.: `${GATEWAY_DELAY_SCALE:-1}`), nunca um valor < 1.

### C-F03-06 — Tempos reais do gateway em escala 1: `0001` e `0004` (produto)
- **Como (0001):**
  ```bash
  demo --card 4000000000000001 > "$J/c06a.jsonl"; echo "exit=$?"; cat "$J/c06a.jsonl"
  T=$(jf ticketId < "$J/c06a.jsonl")
  sql "SELECT t.status, p.state, p.result, round(extract(epoch FROM p.completed_at - p.started_at)*1000) FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.id = '$T'"
  ```
- **Esperado (0001):** `exit=0`; a linha JSON tem `"last4":"0001"`, `"status":"confirmed"` e `elapsedMs` entre 2000 e 5000. O SQL devolve `confirmed|done|approved|<ms>`, com `<ms>` entre 2000 e 4100.
- **Como (0004):**
  ```bash
  demo --card 4000000000000004 --no-wait > "$J/c06b.jsonl"; T4=$(jf ticketId < "$J/c06b.jsonl")
  sleep 10; sql "SELECT t.status, p.state FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.id = '$T4'"
  sleep 32; sql "SELECT t.status, p.state, p.result, round(extract(epoch FROM p.completed_at - p.started_at)*1000) FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.id = '$T4'"
  ```
- **Esperado (0004):** depois de 10 s: `pending|in_flight`. Depois de 42 s: `declined|done|declined|<ms>`, com `<ms>` entre 30000 e 40100.

### C-F03-07 — `enqueuePayment` só grava, na transação do chamador, e retorna rápido (vitest)
- **Como:** `vt test/f03/enqueue.test.ts "enqueuePayment grava requested e retorna em menos de 200 ms com 0003"`; `vt test/f03/enqueue.test.ts "enqueuePayment participa da transação do chamador"`; `vt test/f03/enqueue.test.ts "enqueuePayment rejeita cardLast4 que não tem 4 dígitos"`.
- **Esperado:** os 3 testes passam. Eles afirmam:
  - `enqueuePayment(pool, ticketId, '0003')` resolve em < 200 ms; a linha de `payments` tem `state='requested'`, `result` nulo e `started_at` nulo, e o ticket continua `pending`;
  - dentro de `withTransaction`, um erro lançado depois do `enqueuePayment` não deixa nenhuma linha em `payments`; com commit, a linha existe;
  - `'4000000000000001'` e `'12a4'` lançam `TypeError`, sem gravar nada.

### C-F03-08 — Dispatcher aplica o resultado de cada final (vitest)
- **Como:** `vt test/f03/dispatcher.test.ts "dispatcher aplica o resultado de cada final"`.
- **Esperado:** passa. O teste cria 5 tickets `pending` (via `insertTicket`) com pagamentos `0001`, `0002`, `0003`, `0004` e `0009`, um `createDispatcher({ gateway: new SimulatedGateway({ scale: 0.001 }), pollMs: 50 })`, `start()` + `kick()` + `idle()`, e afirma:
  - tickets `confirmed`, `declined`, `confirmed`, `declined`, `declined`;
  - `payments.state='done'`, com `result` `approved`/`declined`/`approved`/`declined`/`declined` e `completed_at` preenchido.

### C-F03-09 — Semântica do dispatcher: polling, kick, idle, stop, erro (vitest)
- **Como:** `vt test/f03/dispatcher.test.ts "dispatcher coleta por polling sem kick"`; `vt test/f03/dispatcher.test.ts "kick e idle processam imediatamente"`; `vt test/f03/dispatcher.test.ts "kick com o dispatcher parado não processa nada"`; `vt test/f03/dispatcher.test.ts "stop interrompe a coleta"`; `vt test/f03/dispatcher.test.ts "falha ao aplicar devolve o pagamento para requested"`.
- **Esperado:** os 5 testes passam. Eles afirmam:
  - uma linha `requested` inserida por fixture SQL (sem `kick`) é processada em ≤ 1000 ms com `pollMs: 100`;
  - com `pollMs: 60000`, `kick()` + `idle()` processa o pagamento (gateway falso imediato) antes de `idle()` resolver;
  - sem `start()`, `kick()` + 500 ms deixam o pagamento `requested`;
  - depois de `stop()`, um pagamento novo continua `requested` após 4 × `pollMs`;
  - com um gateway falso que devolve um valor inválido (`'bogus' as GatewayResult`) na 1ª chamada e `approved` na 2ª: a gravação de `payments.result` viola o CHECK do schema e a 1ª aplicação falha (rollback); o pagamento volta a `requested`, é coletado de novo e termina `done`/`approved`, com o ticket `confirmed`, sem nenhum `unhandledRejection` no processo.

### C-F03-10 — Aplicação guardada: só `pending` e só evento não cancelado (vitest)
- **Como:** `vt test/f03/apply.test.ts "applyGatewayResult confirma ou recusa ticket pending e fecha o pagamento"`; `vt test/f03/apply.test.ts "applyGatewayResult não altera ticket que não está pending"`; `vt test/f03/apply.test.ts "applyGatewayResult não confirma ticket de evento cancelado"`.
- **Esperado:** os 3 testes passam. Eles afirmam:
  - `pending` + `approved` → retorna `true`, ticket `confirmed`; `pending` + `declined` → `true`, ticket `declined`; o pagamento fica `done` com o `result` e `completed_at`;
  - para tickets `confirmed`, `declined`, `cancelled` e `refunded` (fixture `insertTicket({ status })`), com `approved` e com `declined`, retorna `false`, o status e o `updated_at` não mudam, e o pagamento fica `done`;
  - com `createEvent({ status: 'cancelled' })` + `insertTicket({ status: 'pending' })`, `applyGatewayResult(id, 'approved')` retorna `false` e o ticket **não** fica `confirmed` (continua `pending`).

### C-F03-11 — Lock `FOR SHARE` serializa com o cancelamento (vitest)
- **Como:** `vt test/f03/apply.test.ts "applyGatewayResult espera o lock do evento e respeita o cancelamento"`.
- **Esperado:** passa. O teste:
  1. com um evento `published` e um ticket `pending`, um cliente dedicado faz `BEGIN; SELECT … FROM events WHERE id=$1 FOR UPDATE`;
  2. chama `applyGatewayResult(ticket, 'approved')` e afirma que ela **não** resolveu após 500 ms;
  3. no mesmo cliente, aplica a fixture de cancelamento (`UPDATE events SET status='cancelled'` + `UPDATE tickets SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled' END …`) e faz `COMMIT`;
  4. afirma que a aplicação resolve `false` e que o ticket termina `cancelled`.

### C-F03-12 — Corrida: cancelamento × 20 respostas simultâneas (vitest)
- **Como:** `vt test/f03/apply.test.ts "corrida: cancelamento contra 20 respostas simultâneas nunca deixa confirmed"`.
- **Esperado:** passa. Em 20 rodadas, cada uma com um evento `published` novo e 20 tickets `pending`, o teste dispara ao mesmo tempo 20 × `applyGatewayResult(t, 'approved')` e a fixture de cancelamento (em transação com `FOR UPDATE` no evento). Ao final de cada rodada, ele afirma:
  - o evento está `cancelled`;
  - há **0** tickets `confirmed`;
  - `refunded + cancelled = 20`;
  - o número de `true` devolvidos é igual ao número de `refunded`.

### C-F03-13 — Concorrência e latência em escala 1: 5 × `0001` em ≤ 5 s, 10 rodadas (vitest)
- **Como:** `vt test/f03/latency.test.ts "5 pagamentos 0001 confirmados em até 5 s, 10 rodadas em escala 1"`.
- **Esperado:** passa. O teste:
  - usa `createDispatcher({ gateway: new SimulatedGateway({ scale: 1 }), pollMs: 250 })`, **sem** `kick()`;
  - em cada uma das 10 rodadas, enfileira 5 pagamentos `0001` com `Promise.all(enqueuePayment…)` e afirma: os 5 tickets ficam `confirmed` em ≤ 5000 ms, medidos desde o início do primeiro `enqueuePayment`;
  - afirma também, por pagamento: `started_at − requested_at ≤ 300 ms`;
  - e, por rodada: `max(completed_at) − min(started_at) ≤ 4300 ms`, o que é impossível se os 5 forem processados em série.

### C-F03-14 — Concorrência e latência no produto: 10 rodadas × 5 (produto)
- **Como:**
  ```bash
  demo --card 4000000000000001 --count 5 --rounds 10 > "$J/c14.jsonl"; echo "exit=$?"
  summ "$J/c14.jsonl"
  EV=$(head -1 "$J/c14.jsonl" | jf eventId)
  sql "SELECT count(*), count(*) FILTER (WHERE t.status = 'confirmed'), max(round(extract(epoch FROM p.started_at - p.requested_at)*1000)), max(round(extract(epoch FROM p.completed_at - p.requested_at)*1000)) FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.event_id = '$EV'"
  ```
- **Esperado:**
  - `exit=0`;
  - `summ` imprime `50 {"confirmed":50} <max>`, com `<max>` ≤ 5000;
  - o SQL devolve `50|50|<coleta>|<total>`, com `<coleta>` ≤ 300 e `<total>` ≤ 5000.

### C-F03-15 — Recuperação no `start()` (vitest)
- **Como:** `vt test/f03/recovery.test.ts "start devolve in_flight para requested e processa os pendentes"`.
- **Esperado:** passa. O teste grava 2 tickets `pending`, um com pagamento `state='in_flight'` (com `started_at` preenchido, simulando uma app que morreu) e outro com `state='requested'`. Depois cria um dispatcher novo (gateway com escala 0.001) e chama `start()`. Em ≤ 2000 ms, afirma: os 2 tickets `confirmed` e os 2 pagamentos `done`.

### C-F03-16 — Recuperação depois de restart abrupto da app (produto)
- **Como:**
  ```bash
  demo --card 4000000000000003 --no-wait > "$J/c16.jsonl"; T=$(jf ticketId < "$J/c16.jsonl")
  sleep 1;  sql "SELECT t.status, p.state FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.id = '$T'"
  docker compose kill app
  docker compose ps --status running --services
  sql "SELECT t.status, p.state FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.id = '$T'"
  npm run up; echo "up=$?"
  sleep 45; sql "SELECT t.status, p.state, p.result FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.id = '$T'"
  ```
- **Esperado:**
  - o 1º SQL devolve `pending|in_flight`;
  - `docker compose ps` lista `db` e **não** lista `app`;
  - o 2º SQL devolve `pending|in_flight`, ou seja, o pagamento ficou órfão com a app morta;
  - `up=0`;
  - o último SQL devolve `confirmed|done|approved`.

### C-F03-17 — O dispatcher sobe com o servidor e para no `close` (vitest + inspeção)
- **Como:** `vt test/f03/server.test.ts "buildApp inicia o dispatcher e app.close o para"`; `vt test/f03/server.test.ts "buildApp com startDispatcher false não inicia o dispatcher"`; `git diff main...HEAD -- src/server.ts`.
- **Esperado:** os 2 testes passam. Eles afirmam:
  - com `buildApp()` + `app.ready()`, um pagamento `0001` inserido por fixture SQL (sem `kick`) deixa o ticket `confirmed` em ≤ 6000 ms;
  - depois de `app.close()`, um pagamento novo continua `requested` após 1500 ms;
  - com `buildApp({ startDispatcher: false })` + `ready()`, o pagamento continua `requested` após 1500 ms.

  O diff de `src/server.ts` contém **somente** o import de `dispatcher` (`./gateway/index.js`) e o bloco condicional com `addHook('onReady', … dispatcher.start() …)` e `addHook('preClose', … dispatcher.stop() …)`, sob `opts?.startDispatcher ?? true`.

### C-F03-18 — XC: ticket enfileirado com `enqueuePayment` confirmado em ≤ 5 s no produto (produto)
- **Como:**
  ```bash
  demo --card 4000000000000001 > "$J/c18.jsonl"; echo "exit=$?"; cat "$J/c18.jsonl"
  T=$(jf ticketId < "$J/c18.jsonl")
  sql "SELECT t.status, p.state, p.result, round(extract(epoch FROM p.completed_at - p.requested_at)*1000) FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.id = '$T'"
  ```
- **Esperado:**
  - `exit=0`;
  - a linha JSON tem `"status":"confirmed"` e `elapsedMs` ≤ 5000;
  - o SQL devolve `confirmed|done|approved|<ms>`, com `<ms>` ≤ 5000.

  O script não tem dispatcher próprio (spec §4.4), então quem processou foi o dispatcher iniciado pelo servidor de F01.

### C-F03-19 — XC: linha inserida direto no schema de F01 é coletada por polling (produto)
- **Como:**
  ```bash
  N=$(node -e "const a='abcdefghijklmnopqrstuvwxyz0123456789';let s='';for(let i=0;i<10;i++)s+=a[Math.floor(Math.random()*36)];console.log(s)")
  C=$(node -e "const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<8;i++)s+=a[Math.floor(Math.random()*32)];console.log(s)")
  sql "INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents, status)
         SELECT 'evt_$N', id, 'XC F03 psql', 'Container db', now() + interval '30 days', 1, 1000, 'draft' FROM users WHERE email = 'org.a@catraca.dev';
       INSERT INTO tickets (id, event_id, buyer_email, channel, code, status, price_cents, card_last4)
         VALUES ('tkt_$N', 'evt_$N', 'xc-f03@example.com', 'partner', '$C', 'pending', 1000, '0001');
       INSERT INTO payments (ticket_id, card_last4) VALUES ('tkt_$N', '0001');"
  sleep 6
  sql "SELECT t.status, p.state, p.result, round(extract(epoch FROM p.completed_at - p.requested_at)*1000) FROM tickets t JOIN payments p ON p.ticket_id = t.id WHERE t.id = 'tkt_$N'"
  ```
- **Esperado:** os INSERTs não dão erro, e o SQL final devolve `confirmed|done|approved|<ms>`, com `<ms>` ≤ 5000.

### C-F03-20 — Escopo de arquivos da branch (inspeção)
- **Como:** `git diff --name-only main...HEAD`.
- **Esperado:** só aparecem arquivos de `src/gateway/` (`card.ts`, `simulated.ts`, `dispatcher.ts`, `index.ts`, `enqueue-demo.ts`), `test/f03/`, `src/server.ts`, `state/project-state.json` e, opcionalmente, `docs/features/F03-gateway/` (sem arquivos em `reports/`). Não aparecem `test/helpers.ts`, `src/features.ts`, `migrations/`, `src/views/` nem `src/auth/`. No `state/project-state.json`, só a entrada `F03` mudou, com `"status": "implemented"`.

### C-F03-21 — Gates verdes (comando)
- **Como:** `npm run gates; echo "exit=$?"` e depois `docker ps --filter "name=$COMPOSE_PROJECT_NAME-gates" -q | wc -l`.
- **Esperado:**
  - `exit=0`;
  - a saída mostra lint e typecheck sem erro e os arquivos `test/f03/*.test.ts` executados sem falhas;
  - a contagem de containers é `0`.

## Mapeamento PRD → contrato

- AC-F03-01 → C-F03-02, C-F03-03, C-F03-06
- AC-F03-02 → C-F03-01
- AC-F03-03 → C-F03-08, C-F03-09, C-F03-10
- AC-F03-04 → C-F03-07
- AC-F03-05 → C-F03-10, C-F03-11, C-F03-12
- AC-F03-06 → C-F03-04, C-F03-05, C-F03-06
- AC-F03-07 → C-F03-15, C-F03-16
- AC-F03-08 → C-F03-13, C-F03-14
- XC-F03-F01-01 → C-F03-17, C-F03-18, C-F03-19

Itens transversais, sem critério específico do PRD e exigidos pelas regras 8 e 9 do AGENTS.md: C-F03-20 e C-F03-21.
