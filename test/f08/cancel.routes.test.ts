import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';
import { createEvent, insertTicket, loginAs, resetDb } from '../helpers.js';
import {
  eventStatus,
  getPage,
  ORG_A,
  ORG_B,
  PARTICIPANT,
  postForm,
  SEED_PASSWORD,
  snapshot,
  ticketStatus,
  userIdByEmail,
} from './support.js';

describe('F08 rota POST /org/events/:id/cancel e _cancel.ejs', () => {
  let app: FastifyInstance;
  let orgA: string;
  let cookieA: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    orgA = await userIdByEmail(ORG_A);
    cookieA = await loginAs(app, ORG_A, SEED_PASSWORD);
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F08-10 botão em published, nada em draft, 303 do dono e aviso Evento cancelado depois', async () => {
    const draft = await createEvent({ organizerId: orgA, status: 'draft', name: 'Rascunho F08' });
    const draftPage = await getPage(app, `/org/events/${draft.id}`, cookieA);
    expect(draftPage.statusCode).toBe(200);
    expect(draftPage.body).not.toContain(`action="/org/events/${draft.id}/cancel"`);
    expect(draftPage.body).not.toContain('Cancelar evento');
    expect(draftPage.body).not.toContain('data-event-cancelled');

    const ev = await createEvent({ organizerId: orgA, name: 'Publicado F08' });
    const t = await insertTicket({ eventId: ev.id, status: 'confirmed' });
    const page = await getPage(app, `/org/events/${ev.id}`, cookieA);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`action="/org/events/${ev.id}/cancel"`);
    expect(page.body).toContain('data-cancel-form');
    expect(page.body).toContain('Cancelar evento');
    expect(page.body).not.toContain('data-event-cancelled');

    const res = await postForm(app, `/org/events/${ev.id}/cancel`, cookieA);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/org/events/${ev.id}`);
    expect(await eventStatus(ev.id)).toBe('cancelled');
    expect(await ticketStatus(t.id)).toBe('refunded');

    const after = await getPage(app, `/org/events/${ev.id}`, cookieA);
    expect(after.statusCode).toBe(200);
    expect(after.body).toContain('<p data-event-cancelled>Evento cancelado</p>');
    expect(after.body).not.toContain('Cancelar evento');
    expect(after.body).not.toContain(`action="/org/events/${ev.id}/cancel"`);
  });

  it('C-F08-11 cancelamento de draft ou já cancelado responde 409 com data-cancel-error e sem efeito', async () => {
    const draft = await createEvent({ organizerId: orgA, status: 'draft', name: 'Rascunho 409' });
    await insertTicket({ eventId: draft.id, status: 'pending' });
    const cancelled = await createEvent({ organizerId: orgA, status: 'cancelled', name: 'Cancelado 409' });
    await insertTicket({ eventId: cancelled.id, status: 'refunded' });
    const before = await snapshot();

    for (const ev of [draft, cancelled]) {
      const res = await postForm(app, `/org/events/${ev.id}/cancel`, cookieA);
      expect(res.statusCode).toBe(409);
      expect(res.headers.location).toBeUndefined();
      expect(res.body).toContain(`<section data-event-id="${ev.id}">`);
      expect(res.body).toContain('<p data-cancel-error>Só é possível cancelar um evento publicado.</p>');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('C-F08-12 outro organizador 404, participante 403 e visitante 302 para login, sem efeito', async () => {
    const ev = await createEvent({ organizerId: orgA, name: 'Evento Secreto F08', venue: 'Local Secreto F08' });
    await insertTicket({ eventId: ev.id, status: 'confirmed' });
    await insertTicket({ eventId: ev.id, status: 'pending' });
    const before = await snapshot();

    const cookieB = await loginAs(app, ORG_B, SEED_PASSWORD);
    const b = await postForm(app, `/org/events/${ev.id}/cancel`, cookieB);
    expect(b.statusCode).toBe(404);
    expect(b.body).not.toContain('Evento Secreto F08');
    expect(b.body).not.toContain('Local Secreto F08');

    const cookieP = await loginAs(app, PARTICIPANT, SEED_PASSWORD);
    const p = await postForm(app, `/org/events/${ev.id}/cancel`, cookieP);
    expect(p.statusCode).toBe(403);
    expect(p.body).not.toContain('Evento Secreto F08');

    const v = await postForm(app, `/org/events/${ev.id}/cancel`, null);
    expect(v.statusCode).toBe(302);
    expect(String(v.headers.location).startsWith('/login')).toBe(true);

    const none = await postForm(app, '/org/events/evt_naoexiste0/cancel', cookieA);
    expect(none.statusCode).toBe(404);

    expect(await eventStatus(ev.id)).toBe('published');
    expect(await snapshot()).toEqual(before);
  });
});
