import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { createEvent, loginAs, resetDb } from '../helpers.js';
import {
  eventForm,
  futureLocal,
  getPage,
  line,
  ORG_A,
  ORG_B,
  PARTICIPANT,
  postForm,
  SEED_PASSWORD,
  userId,
} from './_support.js';

async function countEvents(): Promise<number> {
  return (await query<{ n: number }>('SELECT count(*)::int AS n FROM events')).rows[0].n;
}

describe('F04 área do organizador', () => {
  let app: FastifyInstance;
  let cookieA: string;
  let cookieB: string;
  let cookieP: string;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    cookieA = await loginAs(app, ORG_A, SEED_PASSWORD);
    cookieB = await loginAs(app, ORG_B, SEED_PASSWORD);
    cookieP = await loginAs(app, PARTICIPANT, SEED_PASSWORD);
    orgA = await userId(ORG_A);
    orgB = await userId(ORG_B);
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F04-01 criação válida grava rascunho do organizador logado', async () => {
    const form = await getPage(app, '/org/events/new', cookieA);
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('data-form="create"');
    expect(form.body).toContain('novalidate');

    const startsAt = futureLocal(30);
    const res = await postForm(app, '/org/events/new', cookieA, eventForm({ startsAt, price: '100,00' }));
    expect(res.statusCode).toBe(303);
    const m = /^\/org\/events\/(evt_[a-z0-9]{10})$/.exec(res.headers.location as string);
    expect(m).not.toBeNull();
    const id = m![1];

    const row = (
      await query(
        `SELECT organizer_id, status, name, venue, capacity, price_cents, published_at,
                to_char(starts_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') AS local
           FROM events WHERE id = $1`,
        [id],
      )
    ).rows[0];
    expect(row).toEqual({
      organizer_id: orgA,
      status: 'draft',
      name: 'Jazz no Porão',
      venue: 'Bar do Porão',
      capacity: 2,
      price_cents: 10000,
      published_at: null,
      local: startsAt,
    });

    const dot = await postForm(app, '/org/events/new', cookieA, eventForm({ name: 'Workshop', price: '100.00', capacity: '1' }));
    expect(dot.statusCode).toBe(303);
    expect(await countEvents()).toBe(2);
  });

  it('C-F04-02 criação inválida responde 422 e re-renderiza o formulário', async () => {
    const cases: Array<[Record<string, string>, string, string]> = [
      [{ name: '' }, 'name', 'Informe o nome do evento.'],
      [{ venue: '' }, 'venue', 'Informe o local do evento.'],
      [{ startsAt: '' }, 'startsAt', 'Informe a data e hora de início.'],
      [{ startsAt: 'amanhã' }, 'startsAt', 'Data e hora de início inválidas.'],
      [{ capacity: '' }, 'capacity', 'Informe a lotação.'],
      [{ capacity: '0' }, 'capacity', 'A lotação deve ser de pelo menos 1.'],
      [{ capacity: '2.5' }, 'capacity', 'A lotação deve ser um número inteiro.'],
      [{ price: '' }, 'price', 'Informe o preço.'],
      [{ price: '0,00' }, 'price', 'O preço deve ser maior que zero.'],
      [{ price: '-5' }, 'price', 'O preço deve ser maior que zero.'],
      [{ price: 'abc' }, 'price', 'Preço inválido. Use o formato 100,00.'],
    ];
    for (const [over, fieldName, message] of cases) {
      const res = await postForm(app, '/org/events/new', cookieA, eventForm({ name: 'Jazz Teste', ...over }));
      expect(res.statusCode, JSON.stringify(over)).toBe(422);
      expect(res.headers.location).toBeUndefined();
      expect(res.body.split('\n').filter((l) => l.includes('data-form="create"'))).toHaveLength(1);
      expect(line(res.body, `data-error="${fieldName}"`)).toContain(message);
      if (over.capacity === '0') {
        expect(res.body.split('\n').filter((l) => l.includes('value="Jazz Teste"'))).toHaveLength(1);
        expect(res.body).toContain('name="capacity" value="0"');
      }
    }
    // Data no passado (C-F04-03).
    const past = await postForm(app, '/org/events/new', cookieA, eventForm({ name: 'Ontem', startsAt: '2020-01-01T20:00' }));
    expect(past.statusCode).toBe(422);
    expect(line(past.body, 'data-error="startsAt"')).toContain('A data de início precisa estar no futuro.');
    // Campo duplicado conta como ausente.
    const dup = await postForm(app, '/org/events/new', cookieA, { ...eventForm(), name: ['A', 'B'] });
    expect(dup.statusCode).toBe(422);
    expect(line(dup.body, 'data-error="name"')).toContain('Informe o nome do evento.');

    expect(await countEvents()).toBe(0);
  });

  it('C-F04-14 lista de eventos mostra só os do organizador logado', async () => {
    const a1 = await createEvent({ organizerId: orgA, name: 'Jazz no Porão', status: 'draft' });
    const a2 = await createEvent({ organizerId: orgA, name: 'Show A', capacity: 4 });
    const b1 = await createEvent({ organizerId: orgB, name: 'Evento do B' });

    const resA = await getPage(app, '/org/events', cookieA);
    expect(resA.statusCode).toBe(200);
    expect(resA.body).toContain(`data-event-id="${a1.id}" data-event-status="draft"`);
    expect(resA.body).toContain(`data-event-id="${a2.id}" data-event-status="published"`);
    expect(resA.body).toContain(`href="/org/events/${a1.id}"`);
    expect(resA.body).not.toContain(b1.id);
    expect(resA.body).not.toContain('Evento do B');
    expect(resA.body).toContain('data-action="new"');

    const resB = await getPage(app, '/org/events', cookieB);
    expect(resB.statusCode).toBe(200);
    expect(resB.body).toContain(`data-event-id="${b1.id}"`);
    expect(resB.body).not.toContain(a1.id);
    expect(resB.body).not.toContain(a2.id);
    expect(resB.body).not.toContain('Jazz no Porão');

    await resetDb();
    const c = await loginAs(app, ORG_A, SEED_PASSWORD);
    const empty = await getPage(app, '/org/events', c);
    expect(empty.body).toContain('Você ainda não criou eventos.');
  });

  it('C-F04-15 outro organizador recebe 404 sem dados em GET e POST', async () => {
    const pub = await createEvent({ organizerId: orgA, name: 'Jazz no Porão', capacity: 3 });
    const draft = await createEvent({ organizerId: orgA, name: 'Workshop Ponto', status: 'draft', capacity: 1 });
    const before = (await query('SELECT * FROM events ORDER BY id')).rows;

    const get = await getPage(app, `/org/events/${pub.id}`, cookieB);
    expect(get.statusCode).toBe(404);
    expect(get.body).not.toContain('Jazz no Porão');
    expect(get.body).not.toContain('data-field=');
    expect(get.body).not.toContain('data-seat=');
    expect(get.body).toContain('data-error-status="404"');

    const edit = await postForm(app, `/org/events/${pub.id}`, cookieB, eventForm({ name: 'Invasão', capacity: '50', price: '1,00' }));
    expect(edit.statusCode).toBe(404);
    expect(edit.body).not.toContain('Jazz no Porão');
    // Mesmo com dados inválidos, o não-dono não vê a validação.
    const editInvalid = await postForm(app, `/org/events/${pub.id}`, cookieB, eventForm({ capacity: '0' }));
    expect(editInvalid.statusCode).toBe(404);
    expect(editInvalid.body).not.toContain('data-error=');

    const publish = await postForm(app, `/org/events/${draft.id}/publish`, cookieB);
    expect(publish.statusCode).toBe(404);
    expect(publish.body).not.toContain('Workshop Ponto');

    for (const url of ['/org/events/evt_naoexiste', '/org/events/evt_naoexiste/publish']) {
      const res = url.endsWith('publish') ? await postForm(app, url, cookieA) : await getPage(app, url, cookieA);
      expect(res.statusCode).toBe(404);
    }
    const missingEdit = await postForm(app, '/org/events/evt_naoexiste', cookieA, eventForm());
    expect(missingEdit.statusCode).toBe(404);

    expect((await query('SELECT * FROM events ORDER BY id')).rows).toEqual(before);
  });

  it('C-F04-16 visitante é redirecionado e participante recebe 403', async () => {
    const ev = await createEvent({ organizerId: orgA, name: 'Jazz no Porão' });
    const n = await countEvents();

    for (const url of ['/org/events', `/org/events/${ev.id}`, '/org/events/new']) {
      const res = await getPage(app, url);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toMatch(/^\/login\?next=/);
    }
    for (const url of ['/org/events/new', `/org/events/${ev.id}`, `/org/events/${ev.id}/publish`]) {
      const res = await postForm(app, url, null, eventForm({ name: 'Visitante' }));
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toMatch(/^\/login\?next=/);
    }

    for (const url of ['/org/events', `/org/events/${ev.id}`, '/org/events/new']) {
      const res = await getPage(app, url, cookieP);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('Jazz no Porão');
    }
    for (const url of ['/org/events/new', `/org/events/${ev.id}`, `/org/events/${ev.id}/publish`]) {
      const res = await postForm(app, url, cookieP, eventForm({ name: 'Participante' }));
      expect(res.statusCode).toBe(403);
    }

    expect(await countEvents()).toBe(n);
    const row = (await query('SELECT name, status FROM events WHERE id = $1', [ev.id])).rows[0];
    expect(row).toEqual({ name: 'Jazz no Porão', status: 'published' });
  });
});
