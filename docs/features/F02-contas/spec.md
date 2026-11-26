# Spec — F02 Contas & Acesso

> Wave W1 (**paralela** com F03) · Branch `feat/F02-contas` · Consome: F01 · Consumida por: F04, F05, F07 (e F08, via F04)
> Fontes: [`docs/brief.md`](../../brief.md) ("Quem usa", R13), [`docs/PRD.md`](../../PRD.md) (AC-F02-01…06, XC-F02-F01-01), [`docs/architecture.md`](../../architecture.md) (§2, §4, §5 "F02 — auth"). Os nomes e assinaturas são os do `architecture.md`. Onde esta spec acrescenta algo, isso está marcado como **(complemento)**.

## 1. Objetivo

Dar identidade e controle de acesso ao produto:

- o participante cria a própria conta (nome, e-mail, senha), entra e sai;
- os organizadores da seed entram e saem;
- a sessão por cookie preenche `request.user` em todas as requisições;
- os guards `requireOrganizer` e `requireParticipant` aplicam R13 ("participante e visitante não acessam a área de organizador") e protegem as rotas de participante;
- não existe cadastro de organizador pelo produto.

## 2. Escopo

**Dentro:**
- `GET/POST /signup`, `GET/POST /login`, `POST /logout` e `GET /logout`.
- A sessão em `sessions` (cookie `sid`, 7 dias); `request.user`; `reply.locals.user` para as views.
- Os guards `requireOrganizer` e `requireParticipant`.
- **(complemento)** a rota `GET /org`, índice da área de organizador (`requireOrganizer` → 302 para `/org/events`).
- **(complemento)** um hook global que aplica `requireOrganizer` a todo caminho `/org` ou `/org/*`, como defesa em profundidade de R13.
- `verifyPassword` em `src/auth/password.ts`.
- As views `auth/login.ejs` e `auth/signup.ejs` e a navegação do `layout.ejs` (usuário logado + "Sair").
- O helper de teste `loginAs`.

**Fora:**
- As rotas `/org/events…` (lista, criação, gestão): F04. Em F02, `/org/events` ainda não existe: o organizador recebe 404 e o visitante/participante é barrado pelo hook.
- `/me/tickets` e a compra: F05. F02 só cria o link "Meus ingressos" no layout.
- Recuperação de senha, verificação de e-mail, edição de perfil, CSRF por token e rate limiting: fora de escopo pelo PRD §10.
- Cadastro de organizador: não existe, por definição (brief).
- Migrações: as tabelas `users` e `sessions` já existem (F01).

## 3. Decisões técnicas (e por quê)

| # | Decisão | Por quê |
|---|---|---|
| D1 | `authPlugin` é envolvido em `fastify-plugin` (`name: 'catraca-auth'`) e registrado por **uma** entrada em `src/features.ts`. O próprio plugin registra os hooks e as rotas de `routes.ts`. | Os hooks e o decorator `request.user` valem para a instância raiz, ou seja, para as rotas de F04–F08. A mudança em `features.ts` é mínima, o que reduz o conflito com F03 na wave paralela. |
| D2 | Hook `onRequest` nº 1: lê o cookie `sid` e faz `SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()`. Preenche `request.user` (ou `null`) e `reply.locals.user`. | Roda antes do parsing do corpo e de qualquer `preHandler`, então todo guard e toda view já encontram o usuário. Sessão expirada vale como "sem sessão". |
| D3 | Hook `onRequest` nº 2 **(complemento)**: se o path (sem query string) for `/org` ou começar com `/org/`, executa `requireOrganizer`. | Garante R13 em **qualquer** rota `/org/*`, inclusive em uma que F04/F07/F08 esqueça de proteger, e até em caminhos inexistentes. Visitante e participante nunca chegam ao handler nem ao 404. As rotas de F04+ continuam usando `requireOrganizer` (exigência do `architecture.md`); a dupla chamada é idempotente. |
| D4 | Os guards enviam a resposta (`reply.redirect(…, 302)` ou HTML 403 renderizado com `reply.viewAsync('error.ejs', …)` + `reply.code(403).type('text/html; charset=utf-8').send(html)`) **antes** de a promise resolver. | Em hooks `async`, o Fastify só interrompe a cadeia se a resposta já tiver sido enviada. Renderizar com `viewAsync` e depois chamar `send` evita que o handler protegido rode, o que é crítico em POSTs. Um teste garante que o handler não executa. |
| D5 | Sessão: id = `randomBytes(32).toString('base64url')` (43 caracteres), `expires_at = now() + interval '7 days'`. O cookie `sid` vai com `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, `maxAge: 604800` (segundos), sem `secure` (produto local em http). | Atende a `architecture.md` §5 e a AC-F02-06. Cada login cria uma sessão **nova**, o que evita fixação de sessão. |
| D6 | Logout: `DELETE FROM sessions WHERE id = $1` + `reply.clearCookie('sid', { path: '/' })`. | O cookie antigo deixa de autenticar mesmo que alguém o guarde. |
| D7 | E-mail normalizado com `trim().toLowerCase()` no cadastro e no login. A busca usa `lower(email) = lower($1)`. A duplicidade é detectada por pré-checagem **e** pela violação `23505` de `users_email_lower_uq`. | Faz a unicidade não diferenciar maiúsculas e continua correto sob corrida (dois cadastros simultâneos). |
| D8 | `/signup` lê só `name`, `email`, `password` e `next` do corpo. O `INSERT` usa `role` **literal** `'participant'`. | AC-F02-04: um campo `role=organizer` adulterado é ignorado. |
| D9 | Redirecionamentos: em POST de sucesso, `303 See Other`; em guard, `302` para `/login?next=<encodeURIComponent(request.url)>`; em `GET /logout`, `302`. Depois do login, o organizador **sempre** vai para `/org/events` e o participante vai para `next` (se seguro) ou `/`. Depois do signup, o destino é `next` seguro ou `/`. | Segue o `architecture.md` §5. O 303 faz o navegador seguir com GET. |
| D10 | `next` é seguro se for string, começar com `/`, não começar com `//` nem com `/\`, não tiver caracteres de controle e tiver até 2048 caracteres. Senão (ou se vazio), vale `/`. | Evita open redirect (`//evil.com`, `https://…`). |
| D11 | `verifyPassword` faz o parse de `scrypt$<salt>$<hash>`, recalcula com os mesmos parâmetros de F01 (salt em bytes brutos, N=16384, r=8, p=1, keylen 64) e compara com `timingSafeEqual`. Hash malformado → `false`, sem lançar exceção. | Usa o formato fixado em F01 (`architecture.md` §3/§4). |
| D12 | Senha mínima de 6 caracteres no cadastro. | O brief não fixa a regra; o PRD exige rejeitar campo vazio. 6 caracteres é um mínimo razoável e compatível com a seed (`catraca123`). |
| D13 | As views recebem o usuário por `reply.locals.user` (o `@fastify/view` mescla `reply.locals` nos dados de toda view, inclusive no layout). O layout lê `locals.user`, então funciona mesmo que a variável não exista. | O layout mostra o usuário logado em qualquer página, sem que cada rota de F04–F08 precise passar `user`. Se o `@fastify/view` já declarar o tipo `reply.locals`, F02 o reutiliza; senão, decora `locals` com `hasReplyDecorator`/`decorateReply`. |

## 4. Interfaces PROVIDAS

### 4.1 TypeScript (assinaturas fixas do `architecture.md` §5)

```ts
// src/auth/plugin.ts  (fastify-plugin; registrado via features.ts)
declare module 'fastify' {
  interface FastifyRequest { user: { id: string; name: string; email: string; role: 'participant'|'organizer' } | null }
}
export const authPlugin: FastifyPluginAsync;                          // nome importado em src/features.ts
export type SessionUser = NonNullable<FastifyRequest['user']>;        // (complemento)
export const SESSION_COOKIE = 'sid';                                  // (complemento)
export const SESSION_TTL_SECONDS = 604800;                            // (complemento) 7 dias
export async function createSession(userId: string): Promise<string>; // (complemento) INSERT em sessions; devolve o id
export async function destroySession(sid: string): Promise<void>;     // (complemento) DELETE da sessão

// src/auth/guards.ts
export async function requireOrganizer(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  // sem user -> 302 /login?next=<encodeURIComponent(req.url)>; role !== 'organizer' -> 403 error.ejs
  //   { status: 403, title: 'Acesso negado', message: 'Esta área é restrita a organizadores.' }
export async function requireParticipant(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  // sem user -> 302 /login?next=<encodeURIComponent(req.url)>; organizer -> 403 error.ejs
  //   { status: 403, title: 'Acesso negado', message: 'Esta área é restrita a participantes.' }
// Uso pelas features: app.get('/org/events', { preHandler: requireOrganizer }, handler)

// src/auth/password.ts   (F01 criou hashPassword; F02 acrescenta)
export function hashPassword(p: string): Promise<string>;
export function verifyPassword(p: string, h: string): Promise<boolean>;

// src/auth/routes.ts     (complemento: registrado por authPlugin)
export async function authRoutes(app: FastifyInstance): Promise<void>;
export function safeNext(v: unknown): string;   // regra de D10; inválido/vazio -> '/'

// test/helpers.ts (F02 acrescenta)
export async function loginAs(app: FastifyInstance, email: string, password: string): Promise<string>;
  // app.inject POST /login (form-urlencoded). Exige 303 + Set-Cookie sid; devolve "sid=<valor>" (pronto para o header Cookie).
  // Senão, lança Error(`loginAs falhou: <status>`).
```

### 4.2 Rotas

| Método e rota | Entrada | Sucesso | Erro |
|---|---|---|---|
| `GET /signup` | query `next?` | `200` `auth/signup.ejs` | — |
| `POST /signup` | `name`, `email`, `password`, `next?` (form-urlencoded); qualquer outro campo é ignorado | Cria `users(role='participant')` + sessão, `Set-Cookie: sid`, `303` → `safeNext(next)` | `422` `auth/signup.ejs` com a mensagem (§6), os valores de `name`/`email` preservados, **sem** `Set-Cookie` e sem criar usuário |
| `GET /login` | query `next?` | `200` `auth/login.ejs` (o `next` vai num campo oculto) | — |
| `POST /login` | `email`, `password`, `next?` | Nova sessão, `Set-Cookie: sid`, `303` → `/org/events` (organizador) ou `safeNext(next)` (participante) | `401` `auth/login.ejs` com `E-mail ou senha inválidos.`, sem `Set-Cookie` e sem criar sessão |
| `POST /logout` | cookie `sid` (opcional) | Apaga a sessão, limpa o cookie, `303` → `/` | — (sem sessão também redireciona) |
| `GET /logout` | idem | Idem, com `302` → `/` | — |
| `GET /org` **(complemento)** | — | Organizador: `302` → `/org/events` | Visitante: `302` → `/login?next=%2Forg`; participante: `403` |
| qualquer `/org` ou `/org/*` (hook D3) | — | Organizador: segue para a rota (ou para o 404 se ela não existir) | Visitante: `302` → `/login?next=<url codificada>`; participante: `403` `error.ejs` sem nenhum dado de evento |

### 4.3 Views e seletores estáveis

- `auth/signup.ejs`: `<form method="post" action="/signup">` com `<input name="name">`, `<input name="email" type="email">`, `<input name="password" type="password">` e `<input type="hidden" name="next">`, e o botão `Criar conta`. Há um link para `/login` (com o mesmo `next`). Se houver erro, a mensagem aparece em `<p data-form-error>MENSAGEM</p>`, exatamente com essa marcação.
- `auth/login.ejs`: `<form method="post" action="/login">` com `email`, `password` e `next` oculto, e o botão `Entrar`. Há um link para `/signup`. O erro usa a mesma marcação `<p data-form-error>MENSAGEM</p>`.
- `layout.ejs`, no `<nav data-nav>` de F01:
  - visitante: `<a href="/login" data-nav-login>Entrar</a>` e `<a href="/signup" data-nav-signup>Criar conta</a>`;
  - logado: `<span data-current-user>NOME</span>` (com escape de HTML) e `<form method="post" action="/logout" data-logout><button type="submit">Sair</button></form>`;
  - organizador logado: também `<a href="/org/events">Meus eventos</a>`;
  - participante logado: também `<a href="/me/tickets">Meus ingressos</a>`.
- `error.ejs` (de F01), com `status: 403`: `<h1 data-error-status="403">Acesso negado</h1>`.

## 5. Interfaces CONSUMIDAS (de F01)

- `buildApp`, `featurePlugins` (`src/features.ts`), `error.ejs` com os locals `{ status, title, message }`, `layout.ejs` com `<nav data-nav>`.
- `query`, `withTransaction`, `Db` (`src/db.ts`); `newId('usr')` (`src/ids.ts`); `hashPassword` (`src/auth/password.ts`).
- O schema: `users` (`users_email_lower_uq`, `role` CHECK) e `sessions`.
- A seed (`org.a@catraca.dev`, `org.b@catraca.dev`, `participante@catraca.dev` / `catraca123`) e `SEED_USERS`.
- Os helpers de teste `resetDb`, `createUser`, `createEvent` e o harness `npm run up | down | gates` (inclusive `npm run gates -- <arquivo>`).
- A dependência `fastify-plugin` (já no `package.json` de F01).

## 6. Casos de erro e mensagens (literais)

| Situação | Status | Mensagem em `<p data-form-error>` |
|---|---|---|
| Signup com `name`, `email` ou `password` vazio (inclusive só espaços) | 422 | `Preencha nome, e-mail e senha.` |
| Signup com e-mail mal formado (não casa `^[^\s@]+@[^\s@]+\.[^\s@]+$` ou tem mais de 254 caracteres) | 422 | `Informe um e-mail válido.` |
| Signup com senha de menos de 6 caracteres | 422 | `A senha precisa ter pelo menos 6 caracteres.` |
| Signup com e-mail já cadastrado (sem diferenciar maiúsculas; inclui contas da seed) | 422 | `Este e-mail já está cadastrado.` |
| Login com e-mail inexistente ou senha errada | 401 | `E-mail ou senha inválidos.` |
| Visitante em `/org*` ou em rota com `requireParticipant` | 302 | → `/login?next=…` |
| Participante em `/org*` | 403 | página `Acesso negado` / `Esta área é restrita a organizadores.` |
| Organizador em rota com `requireParticipant` | 403 | página `Acesso negado` / `Esta área é restrita a participantes.` |

A ordem de validação do signup é: campos vazios → formato do e-mail → tamanho da senha → duplicidade.

## 7. Modelo de dados tocado

- `users`: `INSERT` de participantes (`id = newId('usr')`, e-mail em minúsculas, `password_hash = hashPassword(password)`, `role = 'participant'`). Leitura por `lower(email)`.
- `sessions`: `INSERT` no login/signup, `DELETE` no logout e `DELETE` das sessões expiradas do próprio usuário a cada login bem-sucedido.
- Nenhuma migração nova.

## 8. Regras de negócio citadas

- **R13**: participante e visitante não acessam a área de organizador (hook D3 + `requireOrganizer`). A posse do evento ("cada organizador só vê os próprios eventos") é aplicada por F04/F07/F08 com o `request.user.id` que F02 fornece.
- **"Quem usa" (brief)**: o participante cria a própria conta (nome, e-mail, senha), entra e sai; o organizador não se cadastra pelo produto (AC-F02-04).
- **R09 (indireto)**: "Meus ingressos" é do participante logado; F02 fornece `requireParticipant` e o `user.id` que F05 usa.

## 9. Arquivos

**Cria:**
```
src/auth/plugin.ts  src/auth/guards.ts  src/auth/routes.ts
src/views/auth/login.ejs  src/views/auth/signup.ejs
test/f02/signup.test.ts  test/f02/login.test.ts  test/f02/session.test.ts
test/f02/password.test.ts  test/f02/guards.test.ts  test/f02/layout.test.ts
```

**Altera (só os trechos indicados):**
- `src/auth/password.ts`: acrescenta `verifyPassword`, sem mudar `hashPassword`.
- `src/features.ts`: acrescenta `import { authPlugin } from './auth/plugin.js';` e a entrada `authPlugin,` como **primeira** entrada do array.
- `src/views/layout.ejs`: só o conteúdo de `<nav data-nav>`.
- `test/helpers.ts`: acrescenta `loginAs` no fim do arquivo.
- `state/project-state.json`: só a linha da entrada `F02`. Não mexe em `updatedAt` nem nas outras features, para reduzir o conflito com F03.
- **(registrado na implementação)** `test/f01/http.test.ts`: o teste `rota inexistente responde 404 com error.ejs` passa a chamar `usePlugins()` (só o core) antes de `buildApp`. Ele usava os `featurePlugins` reais e esperava 404 para `/org/events/evt_inexistente/x` como visitante; com o hook D3, esse caminho responde 302 (§4.2, questão 2). O teste continua verificando o 404 genérico do core, que é o seu objetivo; nenhuma asserção foi removida.

**Não altera:** `src/server.ts`, `package.json`/`package-lock.json`, `migrations/`, `compose*.yaml`, `Dockerfile`, `scripts/`, nada de `src/gateway/` (F03).

## 10. Estratégia de testes

- **Integração com `app.inject()`** contra o Postgres efêmero do gates. `beforeEach(resetDb)` e `buildApp({ startDispatcher: false })`.
- Arquivos e nomes exatos (os nomes no código precisam ser idênticos, porque o avaliador os procura na saída `--reporter=verbose`):
  - `test/f02/signup.test.ts`:
    - `signup cria participante logado e redireciona para /`
    - `signup rejeita e-mail já usado (sem diferenciar maiúsculas)`
    - `signup rejeita e-mail mal formado`
    - `signup rejeita campos vazios`
    - `signup rejeita senha com menos de 6 caracteres`
    - `signup ignora role adulterado e sempre cria participant`
    - `signup respeita next seguro`
  - `test/f02/login.test.ts`:
    - `login do participante da seed redireciona para /`
    - `login do participante respeita next seguro e ignora next externo`
    - `login do organizador redireciona para /org/events`
    - `login com senha errada responde 401 sem criar sessão`
    - `login com e-mail inexistente responde 401 sem criar sessão`
    - `logout apaga a sessão e limpa o cookie`
    - `GET /logout também encerra a sessão`
  - `test/f02/session.test.ts`:
    - `request.user é null sem cookie`
    - `request.user é preenchido com sessão válida`
    - `sessão expirada é ignorada`
    - `cookie sid é HttpOnly, SameSite=Lax, Path=/ e dura 7 dias`
    - `loginAs devolve o header Cookie de uma sessão válida`
  - `test/f02/password.test.ts`:
    - `verifyPassword aceita a senha correta e recusa a errada`
    - `verifyPassword recusa hash malformado`
    - `senha do signup é gravada com scrypt e nunca em texto puro`
  - `test/f02/guards.test.ts`:
    - `visitante em /org é redirecionado para /login com next`
    - `visitante em qualquer rota /org/* é redirecionado para /login`
    - `participante em /org/* recebe 403 sem dados de evento`
    - `organizador em /org é redirecionado para /org/events`
    - `requireOrganizer não executa o handler quando barra`
    - `requireParticipant redireciona visitante para /login com next`
    - `requireParticipant responde 403 para organizador`
    - `requireParticipant deixa passar participante`
  - `test/f02/layout.test.ts`:
    - `layout mostra Entrar e Criar conta para visitante`
    - `layout mostra o nome e o botão Sair para usuário logado`
- **Rotas de teste para os guards:** em `guards.test.ts`, depois de `buildApp()` e antes de `ready()`, o teste registra `GET /__test/participante` (`preHandler: requireParticipant`) e `POST /org/__test/acao` (`preHandler: requireOrganizer`). Os handlers incrementam um contador, para provar que não rodam quando o guard barra.
- **"Sem dados de evento":** o teste cria um evento com `createEvent({ organizerId: <org A da seed>, name: 'Evento Secreto F02', venue: 'Porão Secreto', priceCents: 4321 })` e confere que o corpo do 403 não contém `Evento Secreto F02`, `Porão Secreto` nem `43,21`.
- **Fumaça contra o produto** (`npm run up`): os itens HTTP do contrato com `curl` e cookie jar, inclusive XC-F02-F01-01 antes e depois de `npm run down && npm run up`.

## 11. Questões em aberto

1. **Destino do organizador depois do login.** O `architecture.md` fixa: organizador → `/org/events`, ignorando o `next`. Se o organizador B abrir, deslogado, o endereço de gestão de E1 (passo 11 do fluxo), ele cai em `/org/events` depois do login e precisa abrir o endereço de novo. Isso não quebra nenhum critério, porque o fluxo abre o endereço já logado, mas honrar um `next` que comece com `/org/` seria mais natural. Mantive o `architecture.md`; a mudança, se desejada, deve ir primeiro para lá.
2. **Hook global de `/org/*` (D3).** É um acréscimo ao `architecture.md`, que só prevê o `requireOrganizer` por rota. Consequências para as outras specs:
   - F04 **não** deve registrar `GET /org` (pertence a F02);
   - para visitante/participante, uma rota `/org/*` inexistente responde 302/403, e não 404;
   - o 404 "de outro dono" de R13 continua sendo responsabilidade de F04/F07/F08, para organizadores.
3. **Assinatura `Promise<void>` dos guards.** O padrão documentado do Fastify para hooks `async` que respondem cedo é `return reply`. Para manter a assinatura do `architecture.md`, os guards enviam a resposta de forma síncrona (`viewAsync` antes do `send`, D4), e um teste prova que o handler não roda. Se o implementador precisar de `return reply`, a assinatura deveria passar a `Promise<FastifyReply | void>` no `architecture.md`.
4. **Link "Meus ingressos" no layout** aponta para `/me/tickets`, que só existe com F05. Até lá, o participante que clicar recebe o 404 genérico. É aceitável, porque nenhum critério de F02 depende disso.
5. **Senha mínima de 6 caracteres (D12)** é uma decisão desta spec, não do brief. O Fluxo do avaliador (passo 5) não fixa a senha; se o avaliador usar uma senha curta, verá a mensagem e precisará de outra senha.
6. **Conflito previsível com F03 em `state/project-state.json`.** As entradas F02 e F03 são linhas adjacentes, e o git trata a edição de linhas adjacentes como conflito. Quem fizer o merge por último resolve o conflito trivialmente, mantendo as duas linhas. Nenhum dos dois toca em `updatedAt`.
7. **`GET /logout` é sujeito a CSRF de logout.** O `architecture.md` o pede "por conveniência". O impacto é só deslogar o usuário, e CSRF está fora de escopo (PRD §10).
8. **(registrado na implementação) Nav vazio sem o plugin de auth.** O `layout.ejs` só desenha o conteúdo de `<nav data-nav>` quando `locals.user !== undefined` (o hook D2 sempre define `null` ou o usuário). Sem `authPlugin` (testes de F01 que esvaziam `featurePlugins`), o nav continua exatamente `<nav data-nav></nav>`, como o teste de F01 exige.
9. **(registrado na implementação) Tipo de `reply.locals`.** O `@fastify/view` cria `reply.locals` em runtime, mas não o declara nos tipos; `src/auth/plugin.ts` acrescenta `locals: Record<string, unknown>` a `FastifyReply` na mesma augmentation de `request.user`.
