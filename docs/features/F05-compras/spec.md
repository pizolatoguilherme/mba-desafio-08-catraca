# Spec — F05 Compras & Meus ingressos

> Wave **W3** (sequencial). Branch `feat/F05-compras`. Consome F02, F03 e F04 (todas `done` na `main` antes do início).
> Fontes: [`docs/brief.md`](../../brief.md) (R02, R03, R05–R09, gateway), [`docs/PRD.md`](../../PRD.md) (§5 F05, §6), [`docs/architecture.md`](../../architecture.md) (§3, §5 F05, §6, §7).
> As assinaturas desta spec são as do `architecture.md` §5. Onde esta spec acrescenta algo, o acréscimo está marcado como **(acréscimo)** e listado em "Questões em aberto".

## 1. Objetivo

Entregar a **compra de um ingresso** como serviço único e seguro sob concorrência (`purchaseTicket`), usado pela vitrine agora e pela API de parceiros (F06) depois. Entregar também a compra na página do evento (`/events/:id`), a mensagem `Ingressos esgotados` e a página "Meus ingressos" (`/me/tickets`).

O ponto central da feature é **R07**: as vagas ocupadas nunca passam da lotação, nem com compras simultâneas. Esta spec diz como isso é garantido (§8.1) e como é provado (§12.2).

## 2. Escopo e fora de escopo

### Escopo
- `src/purchases/service.ts`: `validatePurchaseInput`, `purchaseTicket` (canais `web` e `partner`), `findTicketById`, `findTicketByCode`, `listTicketsForUser` e o tipo `TicketRow`.
- `src/purchases/routes.ts`: `POST /events/:id/purchase`, `GET /events/:id/purchase` (só redireciona) e `GET /me/tickets`.
- `src/views/purchases/_buy.ejs` (F04 cria o arquivo vazio; F05 preenche) e `src/views/purchases/my-tickets.ejs` (novo).
- Link "Meus ingressos" no layout para participante logado.
- Testes `test/f05/*`, inclusive a prova de R07 com 30 compras simultâneas × 20 rodadas.

### Fora de escopo
- Rotas HTTP da API de parceiros (F06). F05 só garante que `purchaseTicket` aceita `channel: 'partner'` sem `userId`.
- Check-in, painel (F07) e cancelamento (F08). F05 não muda status de ingresso depois da criação; quem faz isso é o dispatcher (F03) e o cancelamento (F08).
- Mais de um ingresso por compra, mapa de assentos, cancelamento ou transferência pelo participante (fora de escopo do brief).
- Bloquear a venda de evento cuja data já passou: o brief não pede (R02 só fala de status).
- Normalizar o número do cartão (remover espaços ou hífens). O cartão precisa ter exatamente 16 dígitos.
- Atualização em tempo real de "Meus ingressos": recarregar a página basta.
- Migrações. O schema de F01 já tem tudo o que F05 usa.

## 3. Regras citadas

| Regra | Como F05 a atende |
|---|---|
| R02 | só evento `published` aceita compra; `draft`, `cancelled` e inexistente → `event_not_available` (vitrine responde 404) |
| R03 | `tickets.price_cents` = `events.price_cents` lido **dentro** do `lockEvent`; uma mudança de preço posterior não altera ingressos já gravados |
| R05 | ocupadas = `pending` + `confirmed` (calculado por `getSeatCounts` de F04, dentro da transação) |
| R06 | uma compra = um ingresso; nasce `pending`, já ocupa vaga, a resposta sai sem esperar o gateway (`enqueuePayment` só grava `payments`) |
| R07 | sem vaga → `sold_out`; vitrine exibe `Ingressos esgotados` no lugar do formulário e como resposta à tentativa; lock pessimista no evento (§8.1) |
| R08 | o dispatcher de F03 aplica `confirmed`/`declined`; `declined` deixa de contar como ocupada, então a vaga volta |
| R09 | código único de 8 caracteres `[A-Z2-9]` (`newTicketCode`), com nova tentativa em colisão; "Meus ingressos" mostra evento, status e código |
| R13 | "Meus ingressos" mostra só os ingressos do `user_id` da sessão |

## 4. Interfaces consumidas

| De | Interface | Uso em F05 |
|---|---|---|
| F01 | `withTransaction(fn)`, `pool`, `query`, `Db` (`src/db.ts`) | transação da compra; consultas de leitura |
| F01 | `newTicketCode()` (`src/ids.ts`), `newId('tkt')` | código e id do ingresso |
| F01 | `statusLabel(s)`, `TicketStatus` (`src/format.ts`) | rótulo em português em "Meus ingressos" |
| F01 | `featurePlugins` (`src/features.ts`) | registro de `purchasesPlugin` (1 linha) |
| F01 | `resetDb`, `createUser`, `createEvent`, `insertTicket` (`test/helpers.ts`) | fixtures de teste |
| F02 | `requireParticipant(req, reply)` (`src/auth/guards.ts`) | guarda das rotas `POST /events/:id/purchase` e `GET /me/tickets` |
| F02 | `request.user` (`src/auth/plugin.ts`) | `userId` e `buyerEmail` da compra pela vitrine; `_buy.ejs` decide entre formulário e link de login |
| F02 | `loginAs(app, email, password)` (`test/helpers.ts`) | cookie de sessão nos testes HTTP |
| F03 | `isValidCardNumber(v)`, `cardLast4(card)` (`src/gateway/card.ts`) | validação do cartão; `card_last4` do ingresso e do pagamento |
| F03 | `enqueuePayment(c, ticketId, cardLast4)` (`src/gateway/dispatcher.ts`) | grava `payments` **na mesma transação** da compra |
| F03 | `dispatcher.kick()` (`src/gateway/index.ts`) | aciona o dispatcher **depois do commit** |
| F03 | `createDispatcher`, `SimulatedGateway` | só nos testes: dispatcher próprio com escala reduzida |
| F04 | `lockEvent(c, id)` (`src/events/repo.ts`) | `SELECT … FOR UPDATE` na linha do evento |
| F04 | `getSeatCounts(db, eventId)` | vagas disponíveis, chamada **com o mesmo client** da transação, depois do lock |
| F04 | `getPublicEvent(id)` | a rota da vitrine responde 404 se o evento não está `published` |
| F04 | `renderEventPage(reply, event, extra?)` (`src/events/routes-public.ts`; acréscimo da spec de F04 ao architecture.md) | re-renderiza `events/show.ejs` com 409/422, passando `{ event, seats, user, ...extra }` |
| F04 | `src/views/events/show.ejs` (inclui `purchases/_buy.ejs` com `locals`, superconjunto de `{ event, seats, user }`) | página onde o partial de compra aparece |
| F04 | `POST /org/events/:id` (edição) | só nos testes cross-feature (XC-F05-F04-01) |

## 5. Interfaces providas

```ts
// src/purchases/service.ts
import type { TicketStatus } from '../format.js';

export interface TicketRow {                      // (acréscimo: o architecture.md usa TicketRow sem defini-lo)
  id: string; event_id: string; user_id: string | null; buyer_email: string;
  channel: 'web' | 'partner'; code: string; status: TicketStatus; price_cents: number;
  card_last4: string; checked_in_at: Date | null; created_at: Date; updated_at: Date;
}

export type PurchaseError = 'invalid_request' | 'event_not_available' | 'sold_out';

export function validatePurchaseInput(i: { buyerEmail: unknown; cardNumber: unknown }):
  { ok: true } | { ok: false; error: 'invalid_request' };

export async function purchaseTicket(i: { eventId: string; channel: 'web' | 'partner'; userId?: string | null; buyerEmail: string; cardNumber: string }):
  Promise<{ ok: true; ticket: { id: string; code: string; status: 'pending'; eventId: string } } | { ok: false; error: PurchaseError }>;

export async function findTicketById(id: string): Promise<TicketRow | null>;
export async function findTicketByCode(code: string): Promise<TicketRow | null>;   // (acréscimo: listado no PRD §2, ausente no architecture.md)
export async function listTicketsForUser(userId: string): Promise<Array<TicketRow & { event_name: string }>>;

// interno, exportado só para teste (não é interface entre features)
export async function insertTicketWithUniqueCode(c: pg.PoolClient, row: Omit<TicketRow, 'code'|'status'|'checked_in_at'|'created_at'|'updated_at'>, genCode?: () => string): Promise<{ id: string; code: string }>;

// src/purchases/routes.ts
export const purchasesPlugin: FastifyPluginAsync;   // registrado em src/features.ts
```

Detalhes de comportamento:

- **`validatePurchaseInput`**: `ok` somente se `buyerEmail` é `string`, tem ≤ 254 caracteres e casa com `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, **e** `cardNumber` é `string` e `isValidCardNumber(cardNumber)`. Qualquer outro caso (campo ausente, `null`, número, array, objeto, cartão com 15/17 dígitos, letras ou espaços) → `{ ok: false, error: 'invalid_request' }`. Não faz trim nem normalização. O `typeof === 'string'` é checado aqui, sem depender de como F03 implementa `isValidCardNumber`.
- **`purchaseTicket`**: segue exatamente a ordem do architecture.md (ver §7). Erros de banco inesperados propagam (a rota responde 500).
- **`findTicketById(id)`**: `SELECT * FROM tickets WHERE id = $1`; `null` se não existe.
- **`findTicketByCode(code)`**: normaliza com `trim().toUpperCase()` e faz `SELECT * FROM tickets WHERE code = $1`; `null` se não existe. Nenhuma feature depende dela: F07 faz a própria consulta `FOR UPDATE` por `(code, event_id)`.
- **`listTicketsForUser(userId)`**: `SELECT t.*, e.name AS event_name FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.user_id = $1 ORDER BY t.created_at DESC, t.id`. Ingressos de parceiro têm `user_id = null` e nunca aparecem.

## 6. Modelo de dados

F05 não cria tabela nem migração. Usa o schema de F01 (`architecture.md` §3):

| Tabela | Operação de F05 | Colunas |
|---|---|---|
| `events` | leitura sob `FOR UPDATE` (via `lockEvent`) | `id`, `status`, `capacity`, `price_cents` |
| `tickets` | `INSERT` (1 por compra); leituras | `id = newId('tkt')`, `event_id`, `user_id` (`web`: id da sessão; `partner`: `null`), `buyer_email` (`web`: e-mail da sessão; `partner`: o do corpo), `channel`, `code = newTicketCode()`, `status = 'pending'` (default), `price_cents = event.price_cents` do lock, `card_last4 = cardLast4(cardNumber)` |
| `payments` | `INSERT` via `enqueuePayment` (F03), na mesma transação | `ticket_id`, `card_last4`, `state = 'requested'` |

O número completo do cartão **nunca** é gravado nem logado; só os 4 últimos dígitos.

## 7. Fluxo da compra (`purchaseTicket`)

```
1. validatePurchaseInput({ buyerEmail, cardNumber })        → falhou: { ok:false, error:'invalid_request' }  (nenhuma transação aberta)
2. withTransaction(async c => {                              -- READ COMMITTED (default do Postgres)
     ev = await lockEvent(c, eventId)                        -- SELECT … FROM events WHERE id=$1 FOR UPDATE
     if (!ev || ev.status !== 'published') return event_not_available
     seats = await getSeatCounts(c, eventId)                 -- novo statement ⇒ novo snapshot, depois do lock
     if (seats.available <= 0) return sold_out
     { id, code } = await insertTicketWithUniqueCode(c, { …, price_cents: ev.price_cents, card_last4 })
     await enqueuePayment(c, id, card_last4)
     return ok
   })                                                         -- COMMIT libera o lock
3. se ok: dispatcher.kick()                                   -- fora da transação, depois do commit
4. return { ok:true, ticket:{ id, code, status:'pending', eventId } }
```

- `insertTicketWithUniqueCode` faz `INSERT … ON CONFLICT (code) DO NOTHING RETURNING id, code` com até 5 códigos novos. `ON CONFLICT DO NOTHING` não aborta a transação, ao contrário de capturar o erro `23505`, que exigiria `SAVEPOINT`. Depois de 5 colisões seguidas (probabilidade desprezível com 32⁸ ≈ 1,1 × 10¹² códigos), lança erro.
- Se qualquer passo dentro da transação falhar (inclusive `enqueuePayment`), o `ROLLBACK` desfaz o ingresso e o pagamento juntos. Nunca fica ingresso `pending` sem `payments`.
- `kick()` vem **depois** do commit. Antes do commit, o dispatcher não enxergaria a linha de `payments` e só a pegaria no próximo polling (250 ms). A correção não muda, só a latência.

## 8. Decisões técnicas

### 8.1 R07 sob concorrência: lock pessimista na linha do evento

**Decisão.** Toda compra roda numa transação em **READ COMMITTED** (o nível padrão do Postgres, sem `SET TRANSACTION`). O **primeiro** statement relevante é `lockEvent(c, eventId)` = `SELECT … FROM events WHERE id = $1 FOR UPDATE`. A contagem de vagas (`getSeatCounts(c, …)`) e o `INSERT` do ingresso só acontecem **depois** que o lock é obtido, no mesmo client. O lock é liberado no `COMMIT`/`ROLLBACK`.

**Por que funciona.**
1. Duas compras do mesmo evento não podem segurar `FOR UPDATE` na mesma linha ao mesmo tempo. A segunda fica bloqueada no `lockEvent` até a primeira fazer `COMMIT`. A seção "contar vagas → inserir ingresso" vira serial **por evento**.
2. Em READ COMMITTED, **cada statement tira um snapshot novo**. O `SELECT count(*)` de `getSeatCounts`, executado depois do lock, enxerga todos os ingressos já commitados pelas transações que seguraram o lock antes. Como a anterior só libera o lock no commit, o ingresso dela já está visível.
3. Isso **exige** READ COMMITTED e **exige** que a contagem seja um statement separado, posterior ao lock. Em REPEATABLE READ, o snapshot da transação é tirado no primeiro statement (o próprio `lockEvent`, antes de esperar o lock). A contagem então não veria o ingresso da transação anterior e o evento venderia além da lotação, sem erro: a anterior não alterou a linha do evento, então não há falha de serialização. Por isso `getSeatCounts` recebe o `c` da transação e não usa o `pool`.
4. O preço (R03) e o status (R02) vêm da própria linha travada. A edição (F04), a publicação (F04) e o cancelamento (F08) usam o mesmo `lockEvent`, então compra, edição de lotação/preço e cancelamento são serializados entre si. Uma compra nunca usa um preço "meio editado" nem vende depois que o cancelamento commitou.

**Por que não basta "checar e depois inserir" sem lock.** Sem lock, duas (ou trinta) transações leem a contagem ao mesmo tempo: todas veem, por exemplo, 4 ocupadas numa lotação de 5, todas concluem que há vaga e todas inserem. Esse é o *write skew* clássico: cada transação é correta sozinha e o conjunto viola o invariante. Nenhuma constraint do schema expressa "número de linhas de `tickets` com status X ≤ `events.capacity`", e um `UNIQUE` não ajuda, porque o problema é um ingresso que **ainda não existe** (fantasma). Por isso o lock é na linha-pai (`events`), que existe e representa o conjunto. Esse é exatamente o defeito da primeira tentativa (100 lugares, 112 vendidos), e o teste de controle de §12.2 o reproduz de propósito.

**Alternativas consideradas.**

| Alternativa | Como seria | Por que não |
|---|---|---|
| `UPDATE` condicional de contador | coluna `events.occupied`; `UPDATE events SET occupied = occupied + 1 WHERE id = $1 AND status = 'published' AND occupied < capacity RETURNING price_cents`; 0 linhas ⇒ `sold_out` | É atômico e rápido, mas exige coluna nova (migração fora de F01, regra 10 do AGENTS.md) e cria uma **segunda fonte de verdade**. Cada transição que libera vaga (recusa em F03, cancelamento em F08) teria que decrementar o contador na mesma transação. Basta um esquecimento numa feature paralela para o contador divergir de `tickets`, e foi justamente a integração entre features que falhou na primeira tentativa. Com o lock, a fonte única continua sendo `tickets` (R05 = `pending` + `confirmed`). |
| `SERIALIZABLE` + retry | transação serializável; o SSI do Postgres aborta com `40001` uma das transações em conflito; a aplicação repete | É correto, mas com 30 compras simultâneas para 5 vagas, a maioria aborta e repete, várias vezes. Isso dá latência imprevisível, exige um laço de retry com backoff e limite (e decidir o que responder quando o limite estoura) e só protege se **todas** as transações envolvidas (edição, cancelamento, dispatcher) também forem serializáveis. É mais código e mais pontos de falha do que um lock explícito. |
| Advisory lock | `SELECT pg_advisory_xact_lock(hashtext($eventId))` antes de contar | Serializa do mesmo jeito, mas o lock não fica ligado à linha. Edição, publicação e cancelamento (F04/F08) e o `FOR SHARE` do dispatcher (F03) usam locks de linha no evento. Misturar exigiria que todas as features também pegassem o advisory lock. Há colisão de hash entre eventos diferentes (inofensiva, mas serializa à toa), e o lock é invisível para quem lê o schema. `lockEvent` é **um** mecanismo compartilhado e já fixado no architecture.md. |
| Mutex em memória na aplicação | `Map<eventId, Promise>` no processo Node | Só vale para um processo, não protege escritas feitas por outros caminhos (scripts, outra instância) e não serializa com edição e cancelamento, que acontecem no banco. |

**Custo aceito.** As compras do **mesmo** evento são serializadas. Cada transação dura poucos milissegundos (2 SELECTs + 2 INSERTs), então 30 compras simultâneas terminam bem abaixo de 1 s. Eventos diferentes não disputam lock entre si. Para eventos pequenos (o domínio da Catraca), isso sobra.

**Deadlock.** Todas as transações que tocam um evento travam **primeiro a linha do evento** e só depois os ingressos/pagamentos: compra (`FOR UPDATE` → `INSERT tickets` → `INSERT payments`), `applyGatewayResult` (`FOR SHARE` → `UPDATE tickets` → `UPDATE payments`), edição e cancelamento (`FOR UPDATE` → …). Com a mesma ordem de aquisição, não há ciclo de espera. `FOR SHARE` do dispatcher e `FOR UPDATE` da compra se excluem, então uma resposta do gateway espera a compra em andamento terminar (e vice-versa). Isso custa poucos milissegundos e não muda nenhum resultado.

**Pool de conexões.** Cada transação esperando o lock segura uma conexão. O pool de F01 tem `max: 50`, o bastante para as 30 compras simultâneas do passo 15 mais o dispatcher. Acima de 50, as requisições esperam na fila do `pg.Pool` (sem erro), desde que `connectionTimeoutMillis` continue sem limite (o default de F01). F05 não muda o pool. Não há `lock_timeout`: a espera pelo lock é curta e limitada pelo número de compras na fila.

### 8.2 Resposta sem esperar o gateway (R06)
`purchaseTicket` grava o ingresso `pending` e a linha `payments` (`enqueuePayment`) e retorna. Quem chama o gateway é o dispatcher (F03), em background. A rota responde `303 → /me/tickets` em poucos milissegundos, mesmo com o cartão `0003` (30–40 s).

### 8.3 A rota da vitrine checa o evento antes de validar o cartão
`POST /events/:id/purchase` chama `getPublicEvent(id)` **antes** de `purchaseTicket`. Se o evento não está `published`, responde **404** (`error.ejs`), sem dados do evento, mesmo que o cartão também seja inválido. Isso evita re-renderizar `show.ejs` (com nome, local e preço) de um rascunho. A ordem `invalid_request → event_not_available → sold_out` do AC-F05-12 vale para `purchaseTicket`, que é o que F06 usa. Se o evento for cancelado entre o `getPublicEvent` e o lock, `purchaseTicket` devolve `event_not_available` e a rota também responde 404.

### 8.4 Mensagens e literais
- `Ingressos esgotados`: literal exato do brief (sem ponto final), em `<p data-sold-out>`.
- Rótulos de status: sempre `statusLabel(status)` de F01 (`pendente`, `confirmado`, `recusado`, `cancelado`, `estornado`). F05 não tem tabela própria de rótulos.
- Cartão inválido na vitrine: `Número do cartão inválido: informe os 16 dígitos.` em `<p data-purchase-error>`.

### 8.5 Testes não dependem do dispatcher singleton
Nos testes, `buildApp({ startDispatcher: false })`. O singleton fica parado e, pela spec de F03 (D10), `kick()` com o dispatcher parado é no-op. Assim os ingressos ficam `pending` de forma determinística (o que a prova de R07 exige). Para verificar que `kick` é chamado depois do commit, os testes usam `vi.spyOn(dispatcher, 'kick')`. Os testes que precisam do resultado do gateway criam um dispatcher próprio: `createDispatcher({ gateway: new SimulatedGateway({ scale: 0.01 }), pollMs: 20 })`, com `start()` no início e `stop()` no fim.

## 9. Rotas e views

| Rota | Guarda | Comportamento |
|---|---|---|
| `POST /events/:id/purchase` | `requireParticipant` (visitante → `302 /login?next=…`; organizador → `403`) | campo `cardNumber` (form urlencoded). `getPublicEvent(id)` nulo → **404** `error.ejs`. Depois `purchaseTicket({ eventId: id, channel: 'web', userId: user.id, buyerEmail: user.email, cardNumber })`: `ok` → **303** `Location: /me/tickets`; `invalid_request` → **422** `show.ejs` com `purchaseError`; `event_not_available` → **404** `error.ejs`; `sold_out` → **409** `show.ejs` com `soldOut: true` |
| `GET /events/:id/purchase` **(acréscimo)** | nenhuma | **303** → `/events/:id`. Serve para o `next` do login depois de um POST de visitante não cair em 404 |
| `GET /me/tickets` | `requireParticipant` | `listTicketsForUser(user.id)` → `purchases/my-tickets.ejs` |

Nas re-renderizações (409/422), a rota faz `reply.code(409|422)` e depois `return renderEventPage(reply, event, { soldOut: true })` ou `renderEventPage(reply, event, { purchaseError: '…' })` (F04). O helper recalcula `seats` com `getSeatCounts`. Como F04 inclui o partial com `locals` (spec de F04, D10), `soldOut` e `purchaseError` chegam ao `_buy.ejs`, que os lê como `locals.soldOut` e `locals.purchaseError` (sem `ReferenceError` quando `GET /events/:id` renderiza sem eles).

### `src/views/purchases/_buy.ejs` (recebe `{ event, seats, user }` + opcionais)
```
se locals.purchaseError:            <p data-purchase-error><%= purchaseError %></p>
se seats.available === 0 ou locals.soldOut:
                                    <p data-sold-out>Ingressos esgotados</p>
se seats.available > 0:
   sem user:                        <a data-buy-login href="/login?next=/events/<id>">Entre para comprar</a>
   user.role === 'participant':     <form data-buy-form method="post" action="/events/<id>/purchase">
                                      <label>Número do cartão (16 dígitos) <input name="cardNumber" inputmode="numeric" autocomplete="cc-number" required></label>
                                      <button type="submit">Comprar</button>
                                    </form>
   user.role === 'organizer':       <p data-buy-organizer>Compras são feitas com uma conta de participante.</p>
```
Com `seats.available === 0`, `Ingressos esgotados` aparece **no lugar** do formulário: o formulário não é renderizado. Não há atributo `pattern` no input: a validação é do servidor, para o 422 poder ser testado também pelo navegador.

### `src/views/purchases/my-tickets.ejs` (recebe `{ tickets: Array<{ id, code, status, label, event_name }> }`)
```html
<h1>Meus ingressos</h1>
<!-- sem ingressos -->
<p data-my-tickets-empty>Você ainda não tem ingressos.</p>
<!-- com ingressos -->
<table data-my-tickets>
  <thead><tr><th>Evento</th><th>Status</th><th>Código</th></tr></thead>
  <tbody>
    <tr data-ticket-id="tkt_…" data-ticket-code="K7Q2M9XA" data-ticket-status="pending"><td data-col="event">Jazz no Porão</td><td data-col="status">pendente</td><td data-col="code">K7Q2M9XA</td></tr>
  </tbody>
</table>
```
- Os atributos de `<tr>` vêm **nesta ordem**: `data-ticket-id`, `data-ticket-code`, `data-ticket-status`. Cada `<tr>…</tr>` fica numa **única linha** de HTML, para que `grep` funcione nos contratos. `data-ticket-code` e `data-ticket-status` são do architecture.md; `data-ticket-id` é **(acréscimo)** e permite a F06 consultar pela API um ingresso comprado na vitrine (XC-F06-F05-02).
- `data-ticket-status` traz o valor da API (`pending`…); a célula `data-col="status"` traz `statusLabel(status)`.
- O nome do evento usa `<%= %>` (escapado).

### Layout
`src/views/layout.ejs` ganha um link `<a href="/me/tickets" data-nav-my-tickets>Meus ingressos</a>`, exibido só quando `user?.role === 'participant'`, ao lado do nome e do botão "Sair" (F02). É uma alteração de uma linha num arquivo de F01/F02, registrada aqui e no PR.

## 10. Casos de erro e mensagens

| Situação | `purchaseTicket` | Vitrine (`POST /events/:id/purchase`) |
|---|---|---|
| Visitante (sem sessão) | — | `302` → `/login?next=/events/<id>/purchase` (`requireParticipant`) |
| Organizador logado | — | `403` `error.ejs` (`requireParticipant`) |
| Evento inexistente, `draft` ou `cancelled` | `event_not_available` | `404` `error.ejs`, sem dados do evento, nenhum ingresso criado |
| Cartão ausente, com ≠ 16 dígitos, com letras ou espaços, ou repetido no formulário (array) | `invalid_request` | `422` `show.ejs` com `<p data-purchase-error>Número do cartão inválido: informe os 16 dígitos.</p>`, nenhum ingresso criado |
| `buyerEmail` mal formado (só canal `partner`; na vitrine vem da sessão) | `invalid_request` | — |
| Sem vaga (`available <= 0`) no momento do lock | `sold_out` | `409` `show.ejs` com `<p data-sold-out>Ingressos esgotados</p>`, nenhum ingresso criado |
| Sucesso | `{ ok: true, ticket }` | `303` → `/me/tickets` |
| Erro inesperado de banco | lança | `500` (handler de F01) |

## 11. Arquivos

| Arquivo | Ação |
|---|---|
| `src/purchases/service.ts` | **cria** |
| `src/purchases/routes.ts` | **cria** (`purchasesPlugin`) |
| `src/views/purchases/_buy.ejs` | **altera** (F04 criou vazio; F05 preenche) |
| `src/views/purchases/my-tickets.ejs` | **cria** |
| `src/views/layout.ejs` | **altera** (1 link "Meus ingressos" para participante) |
| `src/features.ts` | **altera** (1 linha: `purchasesPlugin`) |
| `test/f05/validation.test.ts`, `service.test.ts`, `concurrency.test.ts`, `gateway.test.ts`, `web-purchase.test.ts`, `my-tickets.test.ts`, `cross-feature.test.ts` | **cria** |
| `state/project-state.json` | **altera** (só a entrada `F05`) |

F05 não altera `show.ejs`, `repo.ts` nem nenhum outro arquivo de F02/F03/F04.

## 12. Estratégia de testes

Todos os testes são vitest de integração contra o Postgres efêmero do `npm run gates`, com `resetDb()` no `beforeEach` e `buildApp({ startDispatcher: false })` quando há HTTP (`app.inject`). `kick()` é no-op com o dispatcher parado, e o spy só observa as chamadas (§8.5).

### 12.1 Unidade e serviço
- `validation.test.ts`: tabela de entradas válidas e inválidas de `validatePurchaseInput` (e-mail sem `@`, sem domínio, com espaço, > 254 caracteres; cartão `123`, 15 e 17 dígitos, letras, espaços, `null`, número `4000000000000001`, array).
- `service.test.ts`: ordem dos erros (`invalid_request` mesmo com evento inexistente; `event_not_available` para inexistente, `draft` e `cancelled`, mesmo com evento cheio; `sold_out`); ingresso `pending` com `price_cents` do evento e linha `payments` `requested` com `card_last4`; o preço muda depois e o ingresso antigo mantém o seu; ingresso pendente ocupa vaga; código no formato `^[A-Z2-9]{8}$` e nova tentativa em colisão (`insertTicketWithUniqueCode` com gerador injetado); canal `partner` sem `userId`; `kick` chamado só em sucesso e depois do commit (a linha já é visível por outra conexão no momento da chamada); exports do módulo.

### 12.2 Prova de R07 (`concurrency.test.ts`)
1. **Pré-condição do pool:** `expect(pool.options.max).toBeGreaterThanOrEqual(31)`. Com menos conexões que promessas, o próprio pool serializaria as compras e o teste não provaria nada. Com ≥ 31, as 30 transações ficam abertas ao mesmo tempo no banco e sobra 1 conexão para o amostrador.
2. **Rajada:** 20 rodadas. Cada rodada cria um evento **novo** `published` com lotação 5 e dispara `Promise.all` de **30** `purchaseTicket` (canais alternados `web`/`partner`, cartão `4000000000000001`, e-mails distintos).
3. **Amostrador:** enquanto a rajada roda, um laço numa conexão dedicada faz `SELECT count(*) FROM tickets WHERE event_id = $1 AND status IN ('pending','confirmed')` a cada ~2 ms e guarda o máximo observado.
4. **Asserções por rodada:** exatamente 5 resultados `ok` e 25 `{ ok: false, error: 'sold_out' }`, nenhum outro erro; ocupadas no fim = 5; **máximo amostrado ≤ 5** (as ocupadas nunca passam da lotação, nem durante a rajada); `count(*)` de `tickets` do evento = 5; `count(*)` de `payments` desses ingressos = 5; os 5 códigos são distintos. Como o dispatcher está parado, nenhum ingresso sai de `pending` e a contagem de ocupadas só cresce: o máximo final também limita todos os instantes.
5. **Controle negativo:** o mesmo laço (1 rodada) com uma implementação **ingênua** escrita no próprio teste (transação sem `lockEvent`: conta, `pg_sleep(0.05)`, insere se havia vaga) **vende mais de 5**. Isso mostra que a rajada realmente produz concorrência no banco e que o teste reprovaria uma implementação sem lock.
6. **Lock compartilhado:** uma transação de teste segura `lockEvent` no evento; um `purchaseTicket` disparado em paralelo **não** resolve em 300 ms; depois do `COMMIT` da transação de teste, ele resolve `ok`. Isso prova que a compra usa o mesmo lock de linha da edição e do cancelamento.

Tempo-limite do arquivo: 60 s. Na prática, roda em poucos segundos.

### 12.3 Gateway (`gateway.test.ts`, escala 0,01)
Dispatcher de teste próprio (§8.5): `0001` → `confirmed`; `0002` → `declined`, e `getSeatCounts().available` volta ao valor anterior à compra; um evento de lotação 1 com compra `0002` fica com 0 vagas enquanto `pending` e volta a 1 depois da recusa.

### 12.4 HTTP (`web-purchase.test.ts`, `my-tickets.test.ts`, `cross-feature.test.ts`)
- Visitante → 302 `/login?next=…`; organizador → 403; participante → 303 `/me/tickets` em < 1 s com `0003`, ingresso `pending` com `user_id` da sessão e `channel = 'web'`.
- Cartão `123` → 422 com `data-purchase-error` e nenhuma linha nova em `tickets`.
- Evento `draft`/`cancelled` (fixture) ou inexistente → 404 sem o nome do evento, nenhuma linha nova.
- Evento cheio: `GET /events/:id` tem `data-sold-out` com `Ingressos esgotados` e **não** tem `data-buy-form`; `POST` → 409 com `Ingressos esgotados`, nenhuma linha nova. Evento com vaga: tem `data-buy-form` e não tem `data-sold-out`. Visitante vê `data-buy-login`.
- "Meus ingressos": os 5 status (fixtures `insertTicket`) aparecem com o rótulo de `statusLabel`; outro participante não vê os ingressos do primeiro; ingresso `partner` com o mesmo e-mail do participante não aparece; sem ingressos → `data-my-tickets-empty`.
- XC-F05-F04-01: 2 compras `pending` em lotação 2 → `POST /org/events/:id` (rota de F04) com lotação 1 → 422 e a lotação continua 2; com lotação 3 é aceito; uma nova compra volta a dar 303.

### 12.5 Tempo real (contrato, produto no ar em escala 1)
O "confirmado em ≤ 5 s com `0001`", a recusa com `0002` e o "< 1 s com `0003`" são verificados por `curl` contra `npm run up` em escala 1 (contrato C-F05-20 a C-F05-28). Os testes automatizados usam escala reduzida.

## 13. Questões em aberto

1. **`findTicketByCode`**: o PRD §2 lista a função como provida por F05, mas o architecture.md §5 não a define. Esta spec a fornece com `findTicketByCode(code: string): Promise<TicketRow | null>` (normaliza com `trim().toUpperCase()`). Nenhuma feature depende dela (F07 faz a própria consulta `FOR UPDATE`). Sugestão: acrescentar a assinatura ao architecture.md.
2. **`TicketRow`**: o architecture.md usa `TicketRow` em `findTicketById`/`listTicketsForUser`, mas não o define nem diz onde mora. F05 o define e exporta de `src/purchases/service.ts` (colunas de `tickets`). F06/F07/F08 devem importá-lo daí.
3. **Re-render de `show.ejs`**: o architecture.md não tem helper para renderizar a página do evento. A spec de F04 acrescenta `renderEventPage(reply, event, extra?)` e passa `locals` inteiro aos partials (F04 D10), e F05 usa os dois. Convém registrar `renderEventPage` no architecture.md §5 (F04). Se o código de F04 na `main` divergir da spec de F04, o implementador de F05 passa os mesmos locals que `GET /events/:id` passa, sem alterar F04, e registra isso no PR.
4. **Acréscimos de interface**: `data-ticket-id` nas linhas de "Meus ingressos", `GET /events/:id/purchase` (redirect) e o link no `layout.ejs`. São aditivos e não quebram nada; ficam registrados aqui e no PR.
5. **`dispatcher.kick()` nos testes**: a spec de F03 (D10) define `kick()` como no-op com o dispatcher parado, então a prova de R07 não precisa de stub. A asserção "chamado depois do commit" supõe que o singleton `dispatcher` aceita `vi.spyOn` (objeto devolvido por `createDispatcher`, não congelado). Se não aceitar, essa asserção passa a observar o efeito: com um dispatcher de teste ativo, o pagamento sai de `requested` antes do próximo polling.
6. **Formato de e-mail**: `validatePurchaseInput` usa `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Se o cadastro de F02 aceitar e-mails que essa regex rejeita (ex.: sem ponto no domínio), um participante assim não conseguiria comprar. O implementador confere a validação de F02 e, se ela for mais permissiva, registra a divergência no PR. Não há impacto nas contas da seed nem no Fluxo do avaliador.
7. **Contrato depende de detalhes de F04 e F01 que não estão no architecture.md, mas estão nas specs delas**: (a) `POST /org/events/new` responde `303` com `Location: /org/events/<id>` (F04 D3), e o contrato extrai o id do `Location`; (b) a edição com lotação < ocupadas responde `422` (F04 D4); (c) `npm run gates -- <args>` roda `npx vitest run <args>` no container dos gates (F01 D6), e é assim que o contrato roda um teste nomeado. Se o código divergir dessas specs, o avaliador usa o equivalente documentado nelas.

## 14. Notas de implementação (registradas pelo implementador)

1. **Link "Meus ingressos" no layout (§9 Layout, §11):** a `main` já traz, desde F02, o link `<a href="/me/tickets">Meus ingressos</a>` no `layout.ejs`, exibido só para participante logado. F05 **não altera** `layout.ejs`: acrescentar `data-nav-my-tickets` quebraria o teste literal de F02 (`test/f02/layout.test.ts`) sem ganho funcional. Nenhum item do contrato depende desse atributo.
2. **`_buy.ejs` e o teste C-F04-19 de F04:** o partial só renderiza conteúdo quando `seats.available` é número (ou com `soldOut`/`purchaseError`). Com os locals vazios do teste de F04 (`{ event: {}, seats: {}, user: null }`) ele continua renderizando vazio, então nenhum teste de F04 precisou mudar.
3. **Questão 6 (e-mail):** o cadastro de F02 usa a mesma regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, ≤ 254), então não há divergência.
4. **Nomes dos testes:** seguem `architecture.md` §8.1 e começam pelo ID do item do contrato (ex.: `C-F05-09 R07: …`); o `-t` do contrato casa por substring.
