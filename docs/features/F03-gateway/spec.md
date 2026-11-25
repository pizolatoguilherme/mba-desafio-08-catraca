# Spec — F03 Gateway simulado & Dispatcher

- **Feature:** F03 · **Wave:** W1 (paralela com F02) · **Branch:** `feat/F03-gateway`
- **Consome:** F01 (somente). **Não depende de F02 nem de F04.**
- **Fontes:** [`docs/brief.md`](../../brief.md) (tabela do gateway, R06, R08, R11), [`docs/PRD.md`](../../PRD.md) (AC-F03-01…08, XC-F03-F01-01), [`docs/architecture.md`](../../architecture.md) §1, §3, §5 (F03), §6, §7.

## 1. Objetivo

Entregar o gateway de pagamento simulado do modo padrão e o processador assíncrono (dispatcher) que aplica a resposta do gateway aos ingressos:

- `SimulatedGateway`: responde conforme o final do cartão, dentro das faixas do brief, com atrasos multiplicados por `GATEWAY_DELAY_SCALE`;
- `enqueuePayment`: grava o pedido de pagamento **na transação do chamador** e retorna sem esperar o gateway (R06);
- dispatcher em background: coleta os pagamentos pendentes por polling (250 ms) ou `kick()`, chama o gateway **concorrentemente** e aplica o resultado com guarda (`pending` e evento não cancelado), sob `FOR SHARE` na linha do evento (R08, R11);
- recuperação depois de restart: nenhum ticket fica `pending` para sempre;
- integração com o servidor de F01: o dispatcher sobe com a app e para no `close`.

## 2. Escopo

Dentro:
- `src/gateway/card.ts`, `simulated.ts`, `dispatcher.ts`, `index.ts` com as assinaturas de `architecture.md` §5 (F03).
- Arranque e parada do dispatcher em `src/server.ts` (acréscimo de import + 2 hooks).
- Script de demonstração/verificação `src/gateway/enqueue-demo.ts` (compilado para `dist/gateway/enqueue-demo.js`), usado pelo contrato para enfileirar pagamentos reais na app subida por `npm run up`.
- Testes em `test/f03/`.

Fora (pertence a outras features):
- Compra (criação do ticket `pending`, `lockEvent`, `sold_out`, `dispatcher.kick()` depois do commit): F05.
- Validação do corpo da compra (`validatePurchaseInput`, que encapsula `isValidCardNumber`): F05.
- Cancelamento do evento e transição `confirmed → refunded` / `pending → cancelled`: F08. Nos testes de F03, o cancelamento é simulado por **fixture SQL** idêntica ao `UPDATE` descrito em `architecture.md` §5 (F08).
- Qualquer rota HTTP ou view: F03 não tem UI nem plugin em `src/features.ts`.
- Gateway real, chaves de pagamento, idempotência de cobrança real, e-mail/notificações (fora de escopo do brief).

## 3. Decisões técnicas (e por quê)

| # | Decisão | Por quê |
|---|---|---|
| D1 | Atrasos em escala 1: finais `0001`, `0002` e "outro" em **2000–4000 ms**; `0003` e `0004` em **30000–40000 ms**. Fórmula: `delayMs = min + Math.round(rnd() * (max - min))`, com `rnd` default `Math.random`. | PRD §1 e AC-F03-01: 2–4 s (dentro dos 2–5 s do brief) somados à latência do dispatcher (≤ 300 ms) garantem `confirmed` em < 5 s para o `0001`. `Math.round` torna os extremos determinísticos (`rnd=()=>0` → `min`; `rnd=()=>0.9999999` → `max`). |
| D2 | `SimulatedGateway.authorize` espera `Math.round(delayMs * scale)` ms com `setTimeout(...).unref()`. `scale` precisa ser finito e ≥ 0 (senão `RangeError`). | A escala vale para todos os finais (AC-F03-06). `unref()` evita que timers de 30–40 s segurem o processo de teste ou do script depois do fim. |
| D3 | `enqueuePayment(c, ticketId, cardLast4)` só faz `INSERT INTO payments (ticket_id, card_last4)` com o `Db` recebido; **não** chama o gateway nem `kick()`. Rejeita (`TypeError`) `cardLast4` que não seja `^\d{4}$`. | Fica na transação do chamador (F05 grava ticket + pagamento atomicamente; rollback desfaz os dois). O `kick()` só pode acontecer **depois** do commit, então é responsabilidade do chamador. Rejeitar algo diferente de 4 dígitos impede que um número de cartão completo seja gravado por engano. |
| D4 | Coleta: `UPDATE payments SET state='in_flight', started_at=now() WHERE id IN (SELECT id FROM payments WHERE state='requested' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100) RETURNING id, ticket_id, card_last4`. Se voltarem 100 linhas, outra coleta roda imediatamente. | Texto de `architecture.md` §5. `SKIP LOCKED` evita dupla coleta; o lote de 100 com re-coleta imediata evita fila acumulada. |
| D5 | Para **cada** linha coletada, dispara sem `await` em série: `gateway.authorize(last4).then(r => applyGatewayResult(ticketId, r))`. | Concorrência exigida por AC-F03-08: 5 pagamentos de 2–4 s precisam terminar em ≤ 5 s, o que é impossível em série. |
| D6 | Laço com `setTimeout` encadeado a cada `pollMs` (default `config.gatewayPollMs = 250`), nunca `setInterval`. `kick()` antecipa a próxima coleta; kicks durante uma coleta em andamento são coalescidos em **uma** coleta extra logo depois. | Sem sobreposição de coletas. O polling é a rede de segurança: um INSERT feito por outro processo (script, psql) é coletado em ≤ `pollMs`. |
| D7 | `applyGatewayResult(ticketId, result)` em `withTransaction`: (1) `SELECT e.status FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.id = $1 FOR SHARE OF e`; (2) se o evento **não** está `cancelled`: `UPDATE tickets SET status = $novo, updated_at = now() WHERE id = $1 AND status = 'pending'`; (3) `UPDATE payments SET state='done', result=$r, completed_at=now() WHERE ticket_id=$1`. Retorna `true` só se o ticket foi alterado. `approved → confirmed`, `declined → declined`. | R08 + R11 (AC-F03-05). O cancelamento (F08) trava o evento com `FOR UPDATE`, que conflita com `FOR SHARE`: as duas operações são serializadas. Se o cancelamento vence, o evento já está `cancelled` e nada é confirmado; se a aplicação vence, o ticket vira `confirmed` e o cancelamento o transforma em `refunded`. Ordem de lock evento → ticket, igual à de compra e cancelamento: sem deadlock. O pagamento termina `done` mesmo quando a guarda recusa, para não ser reprocessado. |
| D8 | `start()`: marca o dispatcher como ativo e a **primeira** coleta é precedida de `UPDATE payments SET state='requested', started_at=NULL WHERE state='in_flight'`. | Há uma única instância de app (architecture §5): todo `in_flight` encontrado no arranque é de um processo que morreu. Ele volta para a fila e é reautorizado (AC-F03-07). |
| D9 | `stop()`: para de agendar coletas, espera a coleta em andamento e as aplicações (`applyGatewayResult`) já iniciadas. Autorizações que ainda estão esperando o timer do gateway são **abandonadas**: o resultado delas é ignorado (contador de geração) e o pagamento fica `in_flight`, recuperado no próximo `start()`. `start()` depois de `stop()` funciona. | Fechar a app não pode esperar até 40 s. No modo simulado, reautorizar é inofensivo. A geração impede que uma autorização antiga aplique resultado depois de um restart no mesmo processo. |
| D10 | `kick()` com o dispatcher parado é no-op. `idle()` resolve quando não há coleta em andamento, kick pendente nem promessa de autorização/aplicação em voo (com o dispatcher parado, resolve assim que as aplicações em andamento terminam). | F05 chama `dispatcher.kick()` sempre. Nos testes com `buildApp({ startDispatcher: false })`, nenhum pagamento pode ser processado "por acidente". `idle()` dá aos testes um ponto de sincronização sem `sleep`. |
| D11 | Erros: falha numa coleta é registrada (`console.error('[dispatcher] …')`) e o laço continua. Falha em `applyGatewayResult` é registrada e o pagamento volta para a fila (`UPDATE payments SET state='requested', started_at=NULL WHERE ticket_id=$1 AND state='in_flight'`). Nenhuma promessa fica sem `catch`. | Um erro transitório de banco não pode derrubar o processo nem deixar ticket `pending` para sempre. |
| D12 | Arranque em `src/server.ts`, dentro de `buildApp`: `if (opts?.startDispatcher ?? true) { app.addHook('onReady', async () => { dispatcher.start(); }); app.addHook('preClose', async () => { await dispatcher.stop(); }); }`. | `architecture.md` §5 (F01): o dispatcher de F03 é iniciado em `server.ts`; nos testes, `buildApp({ startDispatcher: false })`. `onReady` só dispara com `ready()`/`listen()`/`inject()`. `preClose` roda antes dos hooks `onClose`, então o dispatcher para antes de um eventual `pool.end()` de F01. |
| D13 | Script `dist/gateway/enqueue-demo.js` (fonte `src/gateway/enqueue-demo.ts`) que cria um evento `draft` do organizador A da seed, tickets `pending` e chama `enqueuePayment` — **sem** iniciar dispatcher próprio. | Permite provar XC-F03-F01-01, AC-F03-01 (medição real), AC-F03-07 e AC-F03-08 contra a app no ar (`npm run up`) sem depender de F05 (compra), que ainda não existe na W1. Como o script não tem dispatcher, quem processa é o dispatcher do servidor (por polling): isso prova que ele sobe junto com o servidor. Evento `draft` não aparece na vitrine nem na API. |
| D14 | Helpers de teste próprios em `test/f03/_support.ts`; **não** altera `test/helpers.ts`. | F02 (mesma wave) altera `test/helpers.ts` (`loginAs`). Não tocar nele evita conflito de merge. |

## 4. Interfaces PROVIDAS

Assinaturas fixas de `architecture.md` §5 (F03), sem alteração:

```ts
// src/gateway/card.ts
export function isValidCardNumber(v: unknown): v is string;   // /^\d{16}$/ (só ASCII 0-9; typeof v === 'string')
export function cardLast4(card: string): string;              // card.slice(-4)

// src/gateway/simulated.ts
export type GatewayResult = 'approved'|'declined';
export interface PaymentGateway { authorize(cardLast4: string): Promise<GatewayResult>; }
export function decide(cardLast4: string, rnd?: () => number): { result: GatewayResult; delayMs: number }; // tabela; delays em escala 1
export class SimulatedGateway implements PaymentGateway { constructor(opts: { scale: number; rnd?: () => number }); }

// src/gateway/dispatcher.ts
export async function enqueuePayment(c: Db, ticketId: string, cardLast4: string): Promise<void>; // INSERT em payments (na transação do chamador)
export async function applyGatewayResult(ticketId: string, result: GatewayResult): Promise<boolean>; // tx: SELECT events FOR SHARE; UPDATE tickets ... WHERE status='pending' AND evento não cancelado; payments -> done
export interface Dispatcher { start(): void; stop(): Promise<void>; kick(): void; idle(): Promise<void>; }
export function createDispatcher(opts: { gateway: PaymentGateway; pollMs: number }): Dispatcher;

// src/gateway/index.ts
export const dispatcher: Dispatcher;   // singleton: createDispatcher({ gateway: new SimulatedGateway({ scale: config.gatewayDelayScale }), pollMs: config.gatewayPollMs })
```

### 4.1 Tabela de `decide()` (escala 1)

| `cardLast4` | `result` | `delayMs` com `rnd=()=>0` | `rnd=()=>0.5` | `rnd=()=>0.9999999` |
|---|---|---|---|---|
| `0001` | `approved` | 2000 | 3000 | 4000 |
| `0002` | `declined` | 2000 | 3000 | 4000 |
| `0003` | `approved` | 30000 | 35000 | 40000 |
| `0004` | `declined` | 30000 | 35000 | 40000 |
| qualquer outro (`0000`, `0005`, `1234`, `9999`, `''`, `abcd`) | `declined` | 2000 | 3000 | 4000 |

`decide` não aplica escala; quem aplica é `SimulatedGateway`.

### 4.2 Semântica de `Dispatcher`

| Método | Efeito |
|---|---|
| `start()` | Idempotente. Ativa o laço; a primeira coleta é precedida do reset `in_flight → requested` (D8). |
| `kick()` | Com o dispatcher ativo: coleta imediata (ou uma coleta extra logo depois da atual). Parado: no-op. |
| `idle()` | Resolve quando não há coleta em andamento, kick pendente nem autorização/aplicação em voo. |
| `stop()` | Para o laço, espera a coleta atual e as aplicações já iniciadas; abandona autorizações em espera (D9). |

### 4.3 Integração com o servidor (alteração em `src/server.ts`)

`buildApp(opts?: { startDispatcher?: boolean })` (assinatura de F01, inalterada) passa a: com `startDispatcher` ausente ou `true`, iniciar `dispatcher` no `onReady` e pará-lo no `preClose` (D12). Com `startDispatcher: false`, não toca no dispatcher.

### 4.4 Script `dist/gateway/enqueue-demo.js` (adição de F03)

```ts
// src/gateway/enqueue-demo.ts
export interface DemoOptions { card: string; count: number; rounds: number; wait: boolean; timeoutMs: number; }
export interface DemoLine { round: number; eventId: string; ticketId: string; last4: string; status: TicketStatus; elapsedMs: number; }
export async function runDemo(opts: DemoOptions, onLine?: (l: DemoLine) => void): Promise<DemoLine[]>;
```

Uso (dentro do container da app): `node dist/gateway/enqueue-demo.js [--card <16 dígitos>] [--count <1..50>] [--rounds <1..20>] [--no-wait] [--timeout-ms <ms>]`.

- Defaults: `--card 4000000000000001`, `--count 1`, `--rounds 1`, espera ligada, `--timeout-ms 10000`.
- Por execução: cria **um** evento `draft` (`newId('evt')`, nome `Demo F03 <ISO>`, local `Gateway simulado`, início em now()+30 dias, lotação `max(1, count*rounds)`, preço 1000) do organizador `org.a@catraca.dev` (ou, na falta dele, do primeiro `role='organizer'`).
- Por rodada: `count` transações concorrentes, cada uma com `INSERT` do ticket (`newId('tkt')`, `newTicketCode()` com até 5 tentativas em colisão, `channel='partner'`, `user_id` nulo, `buyer_email='demo-f03@example.com'`, `price_cents=1000`, `card_last4`, `status='pending'`) + `enqueuePayment(c, ticketId, cardLast4(card))`. Não faz `kick()` nem inicia dispatcher: quem processa é o dispatcher do servidor.
- Com espera: consulta `tickets.status` a cada 50 ms até sair de `pending` ou estourar `--timeout-ms`. A rodada seguinte só começa depois que a anterior terminou.
- Saída: **uma linha JSON por ticket** em stdout, no formato `{"round":1,"eventId":"evt_…","ticketId":"tkt_…","last4":"0001","status":"confirmed","elapsedMs":2731}`. `elapsedMs` = do commit do ticket até a observação do status final. Com `--no-wait`: `status:"pending"`, `elapsedMs:0`, saída logo depois do commit.
- Código de saída: `0` quando todos chegaram a status final (ou com `--no-wait`); `1` quando algum estourou o timeout; `2` em erro de uso (`cartão inválido: use 16 dígitos`, `--count`/`--rounds` fora do intervalo) ou sem organizador (`nenhum organizador encontrado: rode a seed`), com a mensagem em stderr.

## 5. Interfaces CONSUMIDAS (todas de F01)

```ts
// src/config.ts
config.gatewayDelayScale  // GATEWAY_DELAY_SCALE, default 1
config.gatewayPollMs      // GATEWAY_POLL_MS, default 250
// src/db.ts
pool; query<T>(sql, params?); withTransaction<T>(fn); type Db = pg.Pool | pg.PoolClient;
// src/ids.ts (só o script)
newId('evt'|'tkt'); newTicketCode();
// src/format.ts
type TicketStatus
// src/server.ts
buildApp(opts?: { startDispatcher?: boolean })
// test/helpers.ts
resetDb(); createUser(...); createEvent({ organizerId, status?, ... }); insertTicket({ eventId, status?, ... });
```

Harness de F01: `npm run up` / `npm run down` / `npm run gates`, serviços de compose `app` e `db`, `compose.gates.yaml` com o serviço `gates`.

## 6. Modelo de dados tocado

Nenhuma migração. Só tabelas de `migrations/001_init.sql`:

| Tabela | Operação | Por quem |
|---|---|---|
| `payments` | `INSERT` (`ticket_id`, `card_last4`; `state` default `requested`, `requested_at` default `now()`) | `enqueuePayment` |
| `payments` | `UPDATE state='in_flight', started_at=now()` (coleta); `state='requested', started_at=NULL` (reset/erro); `state='done', result, completed_at=now()` (aplicação) | dispatcher / `applyGatewayResult` |
| `tickets` | `UPDATE status ('pending' → 'confirmed'/'declined'), updated_at` **só** com `status='pending'` e evento não cancelado | `applyGatewayResult` |
| `events` | `SELECT … FOR SHARE` (lock de leitura) | `applyGatewayResult` |
| `events`, `tickets` | `INSERT` de fixture de demonstração (evento `draft`) | `enqueue-demo` (somente quando executado manualmente) |

Ciclo de vida de `payments.state`: `requested → in_flight → done`, com `in_flight → requested` no `start()` e em erro de aplicação.

## 7. Regras citadas

- **R06** — a compra é respondida sem esperar o gateway: `enqueuePayment` só grava (AC-F03-04).
- **R08** — aprovado → `confirmed`, recusado → `declined` (AC-F03-01, AC-F03-03, AC-F03-08, XC-F03-F01-01). A liberação da vaga é consequência de `declined` não contar como ocupada (R05, verificada em F05).
- **R11** — resposta do gateway que chega depois do cancelamento não muda o status (AC-F03-05).
- Tabela do gateway simulado do brief (finais e tempos) e "modo padrão sem chave de pagamento" (AC-F03-01, AC-F03-06).

## 8. Casos de erro e mensagens

| Situação | Comportamento |
|---|---|
| `isValidCardNumber` com não-string, vazio, 15/17 dígitos, letras, espaços, `null`/`undefined`, número JS | retorna `false` (sem exceção) |
| `enqueuePayment` com `cardLast4` fora de `^\d{4}$` | lança `TypeError('cardLast4 deve ter 4 dígitos')`; nada é gravado |
| `enqueuePayment` com `ticketId` inexistente ou já com pagamento | o erro do Postgres (FK / unique) é propagado ao chamador (a transação dele faz rollback) |
| `new SimulatedGateway({ scale })` com `scale` negativo, `NaN` ou infinito | lança `RangeError('scale deve ser um número finito >= 0')` |
| `applyGatewayResult` para ticket inexistente | retorna `false`, nada muda |
| `applyGatewayResult` para ticket que não está `pending` (`confirmed`, `declined`, `cancelled`, `refunded`) | retorna `false`; ticket inalterado; pagamento → `done` com o resultado |
| `applyGatewayResult` com evento `cancelled` | retorna `false`; ticket inalterado (nunca `confirmed`); pagamento → `done` |
| Erro de banco numa coleta | `console.error('[dispatcher] falha na coleta', err)`; próxima coleta em `pollMs` |
| Erro em `applyGatewayResult` | `console.error('[dispatcher] falha ao aplicar resultado', ticketId, err)`; pagamento volta para `requested` |
| Script: cartão inválido / parâmetros fora do intervalo / sem organizador | stderr com a mensagem da §4.4, código 2 |

## 9. Arquivos

Cria:
- `src/gateway/card.ts`
- `src/gateway/simulated.ts`
- `src/gateway/dispatcher.ts`
- `src/gateway/index.ts`
- `src/gateway/enqueue-demo.ts`
- `test/f03/_support.ts` (helpers locais: `insertPayment(ticketId, last4, state?)`, `getPayment(ticketId)`, `getTicketStatus(id)`, `cancelEventFixture(c, eventId)`, `waitFor(fn, timeoutMs)`)
- `test/f03/card.test.ts`, `simulated.test.ts`, `enqueue.test.ts`, `apply.test.ts`, `dispatcher.test.ts`, `recovery.test.ts`, `latency.test.ts`, `server.test.ts`, `enqueue-demo.test.ts`

Altera:
- `src/server.ts` — import de `dispatcher` + bloco de 4 linhas em `buildApp` (D12). Nada mais.
- `state/project-state.json` — somente a entrada `F03`.

Não altera: `src/features.ts`, `test/helpers.ts`, `migrations/`, views, `compose*.yaml`, `Dockerfile`, arquivos de F02.

## 10. Estratégia de testes

- **Unidade (sem banco):** `card.test.ts` e `simulated.test.ts`. `decide()` com `rnd` determinístico nos extremos (0, 0.5, 0.9999999) para cada final. Medição real com `SimulatedGateway({ scale: 1 })` para `0001` e `0002` em paralelo (2–4 s), e com `scale: 0.01` para o `0003` (300–400 ms).
- **Integração (Postgres real do gates, `resetDb()` em `beforeEach`):** fixtures `createEvent` / `insertTicket` de F01 e `insertPayment` local. Dispatchers criados no próprio teste com `createDispatcher({ gateway, pollMs })` — gateway falso imediato (`{ authorize: async l4 => decide(l4).result }`), `SimulatedGateway` com escala pequena ou escala 1 (latência). Todo dispatcher criado num teste é parado em `afterEach`.
- **Corrida:** 20 rodadas de "cancelamento (fixture SQL de F08 sob `FOR UPDATE`) × 20 `applyGatewayResult('approved')` simultâneos". Invariante: nenhum `confirmed` em evento cancelado, e `refunded` = número de `true` devolvidos.
- **Lock determinístico:** um cliente segura `SELECT … FOR UPDATE` no evento; `applyGatewayResult` não resolve em 500 ms; o cliente cancela (fixture) e faz commit; a aplicação resolve `false` e o ticket fica `cancelled`.
- **Latência/concorrência (escala 1):** 10 rodadas de 5 pagamentos `0001`, **sem** `kick()` (pior caso: polling de 250 ms). Cada rodada ≤ 5000 ms desde o primeiro `enqueuePayment`; `started_at − requested_at ≤ 300 ms` por pagamento.
- **Recuperação:** linhas `in_flight` e `requested` pré-existentes processadas depois do `start()`.
- **Servidor:** `buildApp()` inicia o singleton e `app.close()` o para; `buildApp({ startDispatcher: false })` não inicia.
- **Produto no ar (contrato):** `enqueue-demo` + `psql` no container `db` com `npm run up` em escala 1: medição real de `0001` e `0004`, 10 rodadas × 5, restart com pagamento em voo, XC-F03-F01-01.
- Os testes não usam `sleep` fixo para sincronizar: usam `idle()` ou `waitFor` com prazo. Os nomes dos testes não têm metacaracteres de regex, para que `vitest -t "<nome>"` os selecione exatamente.

## 11. Questões em aberto

1. **Script fora do layout.** `architecture.md` §2 lista em `src/gateway/` apenas `card.ts`, `simulated.ts`, `dispatcher.ts` e `index.ts`. F03 acrescenta `src/gateway/enqueue-demo.ts`, que é uma adição e não muda nenhuma interface. Sugere-se registrar o arquivo no §2. O script depende de F01 compilar todo `src/**` para `dist/` e de a imagem final conter `dist/`.
2. **Nomes do compose.** Confirmados pela spec de F01: serviços `app` e `db` em `compose.yaml` (`POSTGRES_USER`/`POSTGRES_DB` = `catraca` no `db`), `gates` em `compose.gates.yaml`, e `GATEWAY_DELAY_SCALE=${GATEWAY_DELAY_SCALE:-1}` no `app`. O `compose.gates.yaml` não define `GATEWAY_DELAY_SCALE`, então o singleton nos testes (`server.test.ts`) roda em escala 1 e o teste espera até 6 s.
3. **Paralelismo de arquivos de teste.** Resolvido pela spec de F01 (D13: `fileParallelism: false`, `testTimeout` 60 s). Os testes longos de F03 (`latency.test.ts`, até ~45 s) declaram timeout próprio de 120 s. Todo dispatcher criado num teste é parado no `afterEach`, porque um dispatcher ativo coletaria qualquer `payments` `requested` do banco compartilhado.
4. **Testes nomeados.** Resolvido pela spec de F01 (D6): `npm run gates -- <arquivo> -t "<nome>" --reporter=verbose` roda só o vitest no container de gates. O contrato usa essa forma.
5. **SIGTERM.** A spec de F01 faz `SIGTERM/SIGINT → app.close() → pool.end()` e chama `buildApp({ startDispatcher: true })` na execução direta, então o `preClose` de F03 (D12) para o dispatcher antes do `pool.end()`. A recuperação (D8) cobre a parada abrupta (`docker compose kill`).
6. **PRD §2 × architecture.** O PRD §2 escreve `enqueuePayment(client, ticketId, card)`, e a architecture escreve `enqueuePayment(c, ticketId, cardLast4)`. Vale a architecture: o chamador (F05) passa `cardLast4(cardNumber)`, e um valor que não tenha 4 dígitos lança `TypeError` (D3).
7. **Reautorização depois de restart.** Um pagamento abandonado (D9) ou recuperado (D8) é autorizado de novo, com um novo atraso (ex.: `0003` leva mais 30–40 s a partir do restart). Isso é aceitável no modo simulado. Um gateway real exigiria idempotência, que está fora de escopo.
8. **Resíduo do script.** Cada execução do `enqueue-demo` cria um evento `draft` do organizador A no banco do ambiente em que roda, e ele aparece em `/org/events` do organizador A (depois de F04). Use o script só no ambiente de avaliação de F03 (`COMPOSE_PROJECT_NAME=catraca-f03`), nunca no ambiente do Fluxo do avaliador.
