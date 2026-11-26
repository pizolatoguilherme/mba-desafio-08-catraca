import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server.js';
import { createEvent, insertTicket, loginAs, resetDb } from '../helpers.js';
import {
  checkedInAt,
  checkinResult,
  getPage,
  ORG_A,
  ORG_B,
  panelMetrics,
  PARTICIPANT,
  postForm,
  SEED_PASSWORD,
  userIdByEmail,
} from './support.js';

describe('F07 rota POST /org/events/:id/checkin', () => {
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

  it('C-F07-13 dono faz check-in e vê a mensagem e o painel atualizado na mesma resposta', async () => {
    const ev = await createEvent({ organizerId: orgA, name: 'Show da Rota' });
    const t = await insertTicket({ eventId: ev.id, status: 'confirmed' });

    const page = await getPage(app, `/org/events/${ev.id}`, cookieA);
    expect(page.body).toContain(`<form method="post" action="/org/events/${ev.id}/checkin"`);
    expect(page.body).toContain('name="code"');
    expect(page.body).toContain('Fazer check-in');
    expect(page.body).not.toContain('data-checkin-result');

    const res = await postForm(app, `/org/events/${ev.id}/checkin`, cookieA, { code: ` ${t.code.toLowerCase()} ` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<p data-checkin-result="ok">Entrada liberada</p>');
    expect(panelMetrics(res.body).checkins).toBe('1');
    expect(await checkedInAt(t.id)).not.toBeNull();

    const again = await postForm(app, `/org/events/${ev.id}/checkin`, cookieA, { code: t.code });
    expect(again.statusCode).toBe(200);
    expect(again.body).toContain('<p data-checkin-result="used">Ingresso já utilizado</p>');
    expect(checkinResult(again.body)).toBe('Ingresso já utilizado');

    const invalid = await postForm(app, `/org/events/${ev.id}/checkin`, cookieA, {});
    expect(invalid.statusCode).toBe(200);
    expect(checkinResult(invalid.body)).toBe('Ingresso inválido para este evento');
  });

  it('C-F07-14 outro organizador recebe 404 sem dados e nada é gravado', async () => {
    const ev = await createEvent({ organizerId: orgA, name: 'Evento Exclusivo de A' });
    const t = await insertTicket({ eventId: ev.id, status: 'confirmed' });
    const cookieB = await loginAs(app, ORG_B, SEED_PASSWORD);

    const post = await postForm(app, `/org/events/${ev.id}/checkin`, cookieB, { code: t.code });
    expect(post.statusCode).toBe(404);
    expect(post.body).not.toContain('Evento Exclusivo de A');
    expect(post.body).not.toContain('data-metric');
    expect(post.body).not.toContain('data-checkin-result');
    expect(await checkedInAt(t.id)).toBeNull();

    const get = await getPage(app, `/org/events/${ev.id}`, cookieB);
    expect(get.statusCode).toBe(404);
    expect(get.body).not.toContain('data-metric');
    expect(get.body).not.toContain('Evento Exclusivo de A');

    const missing = await postForm(app, '/org/events/evt_naoexiste/checkin', cookieA, { code: t.code });
    expect(missing.statusCode).toBe(404);
    expect(await checkedInAt(t.id)).toBeNull();
  });

  it('C-F07-15 participante recebe 403 e visitante é redirecionado para login', async () => {
    const ev = await createEvent({ organizerId: orgA, name: 'Evento Restrito F07' });
    const t = await insertTicket({ eventId: ev.id, status: 'confirmed' });
    const cookieP = await loginAs(app, PARTICIPANT, SEED_PASSWORD);

    const asParticipant = await postForm(app, `/org/events/${ev.id}/checkin`, cookieP, { code: t.code });
    expect(asParticipant.statusCode).toBe(403);
    expect(asParticipant.body).not.toContain('data-metric');
    expect(asParticipant.body).not.toContain('Evento Restrito F07');

    const asVisitor = await postForm(app, `/org/events/${ev.id}/checkin`, null, { code: t.code });
    expect(asVisitor.statusCode).toBe(302);
    expect(String(asVisitor.headers.location)).toMatch(/^\/login/);

    expect(await checkedInAt(t.id)).toBeNull();
  });
});
