# Plano — F02 Contas & Acesso

> Spec: [`spec.md`](spec.md) · Contrato: [`contract.md`](contract.md)
> Wave W1, **em paralelo com F03**. Worktree própria, branch `feat/F02-contas` a partir da `main` com F01. Ambiente isolado: `export COMPOSE_PROJECT_NAME=catraca-f02 CATRACA_PORT=3102`.
> Um commit por etapa, no formato `tipo(F02): descrição`, **sem** linhas de coautoria. Push depois de cada etapa. Os testes rodam com `npm run gates -- <arquivo> --reporter=verbose`.

## Etapa 1: esqueleto mínimo (commit e push imediatos, em até 5 minutos)

- **Arquivos:**
  - `src/auth/plugin.ts`: `authPlugin` com `fastify-plugin` (`name: 'catraca-auth'`), `declare module 'fastify'` com `request.user` e `decorateRequest('user', null)`. Os hooks ainda não fazem nada;
  - `src/auth/guards.ts` e `src/auth/routes.ts`: stubs com as assinaturas da spec §4.1;
  - `src/features.ts`: `import { authPlugin } from './auth/plugin.js';` e `authPlugin,` como primeira entrada.
- **Teste:** `test/f02/session.test.ts` com `request.user é null sem cookie` (rota de teste `GET /__test/me` devolvendo `request.user`). Rodar `npm run gates -- test/f02/session.test.ts`.
- **Commit:** `feat(F02): esqueleto do plugin de auth registrado em features`, e em seguida `git push -u origin feat/F02-contas`. Isso comprova o início paralelo (`scripts/check-parallel.sh`).

## Etapa 2: `verifyPassword`

- **Arquivos:** `src/auth/password.ts` (acrescenta `verifyPassword` com `timingSafeEqual`; hash malformado → `false`).
- **Teste:** `test/f02/password.test.ts` com `verifyPassword aceita a senha correta e recusa a errada` e `verifyPassword recusa hash malformado`.
- **Commit:** `feat(F02): verifyPassword com scrypt e comparação timing-safe`.

## Etapa 3: sessão por cookie e `request.user`

- **Arquivos:** `src/auth/plugin.ts`:
  - `SESSION_COOKIE`, `SESSION_TTL_SECONDS`, `createSession`, `destroySession`;
  - hook `onRequest` nº 1: carrega o usuário da sessão não expirada e preenche `request.user` e `reply.locals.user`.
- **Testes:** `test/f02/session.test.ts`, com `request.user é preenchido com sessão válida` e `sessão expirada é ignorada` (sessão inserida com `expires_at` no passado).
- **Commit:** `feat(F02): sessão em cookie sid e request.user`.

## Etapa 4: guards, hook global de `/org/*` e `GET /org`

- **Arquivos:**
  - `src/auth/guards.ts`: `requireOrganizer` e `requireParticipant`. O 302 vai para `/login?next=…`; o 403 é renderizado com `viewAsync('error.ejs', …)` antes do `send`;
  - `src/auth/plugin.ts`: hook `onRequest` nº 2, para path `/org` ou `/org/*`;
  - `src/auth/routes.ts`: `GET /org` → 302 `/org/events`.
- **Teste:** `test/f02/guards.test.ts`, com os 8 testes de C-F02-11. A rota `GET /__test/participante` usa `requireParticipant`, a rota `POST /org/__test/acao` usa `requireOrganizer`, e as duas têm um contador de execução. O evento-fixture `Evento Secreto F02` confirma que não há vazamento de dados no 403. Para o teste de organizador, usar `createUser({ role: 'organizer' })` e criar a sessão com `createSession`, porque `loginAs` só chega na etapa 6.
- **Commit:** `feat(F02): guards requireOrganizer/requireParticipant e proteção de /org/*`.

## Etapa 5: cadastro de participante

- **Arquivos:**
  - `src/auth/routes.ts`: `GET/POST /signup`, `safeNext`, as validações e mensagens de spec §6, o `role` literal `participant` e o tratamento de `23505`;
  - `src/views/auth/signup.ejs`.
- **Testes:** `test/f02/signup.test.ts`, com os 7 testes de spec §10; `test/f02/password.test.ts`, com `senha do signup é gravada com scrypt e nunca em texto puro`.
- **Commit:** `feat(F02): cadastro de participante com validação e login automático`.

## Etapa 6: login, logout e `loginAs`

- **Arquivos:**
  - `src/auth/routes.ts`: `GET/POST /login`, com o organizador indo sempre para `/org/events` e o participante para `safeNext`. `POST /logout` responde 303 e `GET /logout` responde 302; os dois apagam a sessão e limpam o cookie. O login bem-sucedido apaga as sessões expiradas do usuário;
  - `src/views/auth/login.ejs`;
  - `test/helpers.ts`: `loginAs`, acrescentado no fim do arquivo.
- **Testes:** `test/f02/login.test.ts` (7 testes de spec §10); `test/f02/session.test.ts`, com `cookie sid é HttpOnly, SameSite=Lax, Path=/ e dura 7 dias` e `loginAs devolve o header Cookie de uma sessão válida`. Os testes de organizador da etapa 4 podem passar a usar `loginAs`.
- **Commit:** `feat(F02): login, logout e helper loginAs`.

## Etapa 7: navegação no layout

- **Arquivos:** `src/views/layout.ejs` (só o conteúdo de `<nav data-nav>`, com os seletores de spec §4.3; lê `locals.user`).
- **Teste:** `test/f02/layout.test.ts`, com `layout mostra Entrar e Criar conta para visitante` e `layout mostra o nome e o botão Sair para usuário logado`. O teste também confere o escape de HTML do nome.
- **Commit:** `feat(F02): layout mostra usuário logado e botão Sair`.

## Etapa 8: fumaça do contrato, gates, estado e PR

1. Num clone limpo da branch, com `COMPOSE_PROJECT_NAME=catraca-f02 CATRACA_PORT=3102`, rodar como fumaça todos os itens de `contract.md` (C-F02-01 a C-F02-17), inclusive o C-F02-16 antes e depois de `npm run down && npm run up`. Ao final, `npm run down`.
2. `npm run gates` → saída 0.
3. Atualizar `state/project-state.json` **só** na entrada `F02`: `"status": "implemented"`, `"branch": "feat/F02-contas"` e `"pr"` depois de criar o PR. Não mexer em `updatedAt` nem nas outras entradas.
4. Commit `chore(F02): estado implemented` e push.
5. `gh pr create --base main --head feat/F02-contas --title "F02: Contas & Acesso" --body "<resumo, itens do contrato atendidos, como testar>"`.
6. Conferir `gh pr checks` com o job `gates` em `pass`. Se o número do PR for registrado no estado depois da criação, fazer um commit `chore(F02): registra PR no estado` e push.
7. `COMPOSE_PROJECT_NAME=catraca-f02 npm run down`.
