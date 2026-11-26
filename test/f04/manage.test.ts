import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { buildManageLocals, registerManageSection, renderManagePage } from '../../src/events/manage-sections.js';
import { getOwnedEvent } from '../../src/events/repo.js';
import { buildApp } from '../../src/server.js';
import { createEvent, insertTicket, loginAs, resetDb } from '../helpers.js';
import { eventForm, getPage, line, ORG_A, postForm, SEED_PASSWORD, userId } from './_support.js';

const VIEWS = fileURLToPath(new URL('../../src/views/', import.meta.url));

function countLines(html: string, needle: string): number {
  return html.split('\n').filter((l) => l.includes(needle)).length;
}

describe('F04 página de gestão', () => {
  let app: FastifyInstance;
  let cookieA: string;
  let orgA: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    // Rota de teste fora de /org: re-renderiza a gestão com status e extras do chamador.
    app.get<{ Params: { id: string } }>('/__test/f04-manage/:id', async (req, reply) => {
      const org = await userId(ORG_A);
      const ev = await getOwnedEvent(org, req.params.id);
      reply.code(409);
      return renderManagePage(reply, ev!, org, { flashError: 'Mensagem de teste' });
    });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    cookieA = await loginAs(app, ORG_A, SEED_PASSWORD);
    orgA = await userId(ORG_A);
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F04-19 os partials dos slots existem e não renderizam nada', async () => {
    for (const p of ['purchases/_buy', 'checkin/_panel', 'checkin/_checkin', 'cancel/_cancel']) {
      const html = await ejs.renderFile(`${VIEWS}${p}.ejs`, { event: {}, seats: {}, user: null });
      expect(html.trim(), p).toBe('');
    }
  });

  it('C-F04-05 página de gestão mostra id, dados, edição, publicar e slots', async () => {
    const ev = await createEvent({
      organizerId: orgA,
      status: 'draft',
      name: 'Jazz no Porão',
      venue: 'Bar do Porão',
      capacity: 3,
      priceCents: 10000,
      startsAt: new Date('2026-12-25T23:00:00Z'),
    });
    await insertTicket({ eventId: ev.id, status: 'pending' });
    await insertTicket({ eventId: ev.id, status: 'declined' });

    const res = await getPage(app, `/org/events/${ev.id}`, cookieA);
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toContain(`<section data-event-id="${ev.id}">`);
    expect(countLines(html, `<code data-field="id">${ev.id}</code>`)).toBe(1);
    expect(countLines(html, 'data-form="edit"')).toBe(1);
    expect(countLines(html, `action="/org/events/${ev.id}"`)).toBe(1);
    expect(countLines(html, 'data-form="publish"')).toBe(1);
    expect(countLines(html, `action="/org/events/${ev.id}/publish"`)).toBe(1);
    for (const s of ['panel', 'checkin', 'cancel']) expect(countLines(html, `data-slot="${s}"`)).toBe(1);
    expect(html.indexOf('data-slot="panel"')).toBeLessThan(html.indexOf('data-slot="checkin"'));
    expect(html.indexOf('data-slot="checkin"')).toBeLessThan(html.indexOf('data-slot="cancel"'));
    expect(countLines(html, 'value="2026-12-25T20:00"')).toBe(1);
    expect(countLines(html, 'value="100,00"')).toBe(1);
    expect(countLines(html, 'value="Jazz no Porão"')).toBe(1);
    expect(countLines(html, 'name="capacity" value="3"')).toBe(1);
    expect(line(html, 'data-event-status="draft"')).toContain('rascunho');
    expect(line(html, 'data-field="startsAt"')).toContain('25/12/2026 20:00');
    expect(line(html, 'data-field="venue"')).toContain('Bar do Porão');
    expect(line(html, 'data-field="price"')).toContain('R$ 100,00');
    expect(line(html, 'data-seat="capacity"')).toContain('>3<');
    expect(line(html, 'data-seat="occupied"')).toContain('>1<');
    expect(line(html, 'data-seat="available"')).toContain('>2<');
    expect(html).toContain('Salvar alterações');
    expect(html).toContain('<a href="/org/events">Meus eventos</a>');
    expect(html).not.toContain('data-flash="error"');
  });

  it('C-F04-19 registerManageSection injeta o retorno em buildManageLocals', async () => {
    const ev = await createEvent({ organizerId: orgA, capacity: 4 });
    const row = (await getOwnedEvent(orgA, ev.id))!;
    let seen: { eventId: string; organizerId: string } | null = null;
    registerManageSection('f04-teste', async ({ event, organizerId }) => {
      seen = { eventId: event.id, organizerId };
      return { f04Eco: event.id };
    });
    const locals = await buildManageLocals(row, orgA);
    expect(locals.f04Eco).toBe(ev.id);
    expect(seen).toEqual({ eventId: ev.id, organizerId: orgA });
    expect(locals.event).toEqual(row);
    expect(locals.seats).toEqual({ capacity: 4, occupied: 0, available: 4 });
    expect(locals.canEdit).toBe(true);
    expect(locals.canPublish).toBe(false);
    expect(locals.errors).toEqual({});
    expect(locals.flashError).toBeNull();
    expect(locals.statusLabel).toBe('publicado');

    // Registrar o mesmo nome de novo substitui a função.
    registerManageSection('f04-teste', async () => ({ f04Eco: 'substituído' }));
    expect((await buildManageLocals(row, orgA)).f04Eco).toBe('substituído');
  });

  it('C-F04-19 renderManagePage aplica o status e os extras do chamador', async () => {
    const ev = await createEvent({ organizerId: orgA, name: 'Jazz no Porão' });
    const res = await app.inject({ method: 'GET', url: `/__test/f04-manage/${ev.id}` });
    expect(res.statusCode).toBe(409);
    expect(line(res.body, 'data-flash="error"')).toContain('Mensagem de teste');
    expect(res.body).toContain(`<section data-event-id="${ev.id}">`);
  });

  it('C-F04-13 evento cancelado não mostra edição nem publicar e rejeita POSTs', async () => {
    const ev = await createEvent({ organizerId: orgA, status: 'cancelled', name: 'Show Cancelado', capacity: 5, priceCents: 5000 });
    await insertTicket({ eventId: ev.id, status: 'pending' });
    const snapshot = async () =>
      (await query('SELECT name, capacity, price_cents, status, updated_at, published_at FROM events WHERE id = $1', [ev.id])).rows[0];
    const before = await snapshot();

    const home = await getPage(app, '/');
    expect(home.body).not.toContain(ev.id);
    expect((await getPage(app, `/events/${ev.id}`)).statusCode).toBe(404);

    const page = await getPage(app, `/org/events/${ev.id}`, cookieA);
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('data-form="edit"');
    expect(page.body).not.toContain('data-form="publish"');
    expect(line(page.body, 'data-event-status="cancelled"')).toContain('cancelado');
    expect(line(page.body, 'data-seat="available"')).toContain('>0<');
    expect(countLines(page.body, 'data-slot="cancel"')).toBe(1);

    const edit = await postForm(app, `/org/events/${ev.id}`, cookieA, eventForm({ name: 'Show Editado', capacity: '9', price: '60,00' }));
    expect(edit.statusCode).toBe(409);
    expect(line(edit.body, 'data-flash="error"')).toContain('Evento cancelado não pode ser editado.');
    expect(edit.body).not.toContain('data-form="edit"');

    // Mesmo com dados inválidos, o estado (409) vem antes da validação.
    const invalid = await postForm(app, `/org/events/${ev.id}`, cookieA, eventForm({ capacity: '0' }));
    expect(invalid.statusCode).toBe(409);

    const publish = await postForm(app, `/org/events/${ev.id}/publish`, cookieA);
    expect(publish.statusCode).toBe(409);
    expect(line(publish.body, 'data-flash="error"')).toContain('Evento cancelado não pode ser publicado.');

    expect(await snapshot()).toEqual(before);
  });
});
