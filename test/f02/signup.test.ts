import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { safeNext } from '../../src/auth/routes.js';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { resetDb } from '../helpers.js';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

describe('F02 cadastro', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await app.close();
  });

  function signup(fields: Record<string, string>) {
    return app.inject({ method: 'POST', url: '/signup', headers: FORM, payload: new URLSearchParams(fields).toString() });
  }

  async function userCount(): Promise<number> {
    const r = await query<{ n: string }>('SELECT count(*)::text AS n FROM users');
    return Number(r.rows[0].n);
  }

  function sidCookie(res: Awaited<ReturnType<typeof signup>>): string | undefined {
    return res.cookies.find((c) => c.name === 'sid')?.value;
  }

  async function expectRejected(fields: Record<string, string>, message: string): Promise<void> {
    const before = await userCount();
    const res = await signup(fields);
    expect(res.statusCode).toBe(422);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toContain(`<p data-form-error>${message}</p>`);
    expect(await userCount()).toBe(before);
  }

  it('signup cria participante logado e redireciona para /', async () => {
    const page = await app.inject({ method: 'GET', url: '/signup' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<form method="post" action="/signup">');
    for (const n of ['name="name"', 'name="email"', 'name="password"', 'name="next"', 'Criar conta']) {
      expect(page.body).toContain(n);
    }

    const res = await signup({ name: '  Nova Pessoa ', email: ' Nova.Pessoa@Example.COM ', password: 'segredo123' });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
    const sid = sidCookie(res);
    expect(sid).toBeTruthy();

    const u = await query<{ role: string; name: string; email: string; id: string }>(
      "SELECT id, role, name, email FROM users WHERE lower(email) = 'nova.pessoa@example.com'",
    );
    expect(u.rows).toHaveLength(1);
    expect(u.rows[0]).toMatchObject({ role: 'participant', name: 'Nova Pessoa', email: 'nova.pessoa@example.com' });
    const s = await query('SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2', [sid, u.rows[0].id]);
    expect(s.rowCount).toBe(1);

    const home = await app.inject({ method: 'GET', url: '/', headers: { cookie: `sid=${sid}` } });
    expect(home.body).toContain('<span data-current-user>Nova Pessoa</span>');
  });

  it('signup rejeita e-mail já usado (sem diferenciar maiúsculas)', async () => {
    await expectRejected({ name: 'Outra', email: 'PARTICIPANTE@catraca.dev', password: 'segredo123' }, 'Este e-mail já está cadastrado.');
    await expectRejected({ name: 'Outra', email: 'Org.A@Catraca.Dev', password: 'segredo123' }, 'Este e-mail já está cadastrado.');
    const first = await signup({ name: 'Primeira', email: 'dup@example.com', password: 'segredo123' });
    expect(first.statusCode).toBe(303);
    await expectRejected({ name: 'Segunda', email: 'DUP@EXAMPLE.COM', password: 'segredo123' }, 'Este e-mail já está cadastrado.');
    // valores preservados no formulário re-renderizado
    const res = await signup({ name: 'Segunda', email: 'DUP@EXAMPLE.COM', password: 'segredo123' });
    expect(res.body).toContain('value="Segunda"');
    expect(res.body).toContain('value="DUP@EXAMPLE.COM"');
  });

  it('signup rejeita e-mail mal formado', async () => {
    for (const email of ['nao-e-email', 'a@b', 'a b@example.com', '@example.com', 'x@.', `${'a'.repeat(250)}@example.com`]) {
      await expectRejected({ name: 'Outra', email, password: 'segredo123' }, 'Informe um e-mail válido.');
    }
  });

  it('signup rejeita campos vazios', async () => {
    await expectRejected({ name: '   ', email: 'vazio@example.com', password: 'segredo123' }, 'Preencha nome, e-mail e senha.');
    await expectRejected({ name: 'Outra', email: '', password: 'segredo123' }, 'Preencha nome, e-mail e senha.');
    await expectRejected({ name: 'Outra', email: 'vazio2@example.com', password: '' }, 'Preencha nome, e-mail e senha.');
    await expectRejected({ name: 'Outra', email: 'vazio3@example.com', password: '       ' }, 'Preencha nome, e-mail e senha.');
    await expectRejected({}, 'Preencha nome, e-mail e senha.');
  });

  it('signup rejeita senha com menos de 6 caracteres', async () => {
    await expectRejected({ name: 'Outra', email: 'curta@example.com', password: 'abc12' }, 'A senha precisa ter pelo menos 6 caracteres.');
    const ok = await signup({ name: 'Outra', email: 'seis@example.com', password: 'abc123' });
    expect(ok.statusCode).toBe(303);
  });

  it('signup ignora role adulterado e sempre cria participant', async () => {
    const res = await signup({ name: 'Hacker', email: 'hacker@example.com', password: 'segredo123', role: 'organizer' });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
    const r = await query<{ role: string }>("SELECT role FROM users WHERE email = 'hacker@example.com'");
    expect(r.rows[0].role).toBe('participant');
    const org = await app.inject({ method: 'GET', url: '/org', headers: { cookie: `sid=${sidCookie(res)}` } });
    expect(org.statusCode).toBe(403);
    const n = await query<{ n: string }>("SELECT count(*)::text AS n FROM users WHERE role = 'organizer'");
    expect(n.rows[0].n).toBe('2');
  });

  it('signup respeita next seguro', async () => {
    const page = await app.inject({ method: 'GET', url: '/signup?next=%2Fevents%2Fevt_abc' });
    expect(page.body).toContain('name="next" value="/events/evt_abc"');
    const ok = await signup({ name: 'A', email: 'next1@example.com', password: 'segredo123', next: '/events/evt_abc' });
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe('/events/evt_abc');
    for (const [i, next] of ['//evil.example.com/x', 'https://evil.example.com/', '/\\evil.example.com', ''].entries()) {
      const res = await signup({ name: 'B', email: `next-bad${i}@example.com`, password: 'segredo123', next });
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe('/');
    }
    expect(safeNext('/me/tickets')).toBe('/me/tickets');
    expect(safeNext('/a\nb')).toBe('/');
    expect(safeNext(`/${'a'.repeat(2048)}`)).toBe('/');
    expect(safeNext(['/x'])).toBe('/');
    expect(safeNext(undefined)).toBe('/');
  });
});
