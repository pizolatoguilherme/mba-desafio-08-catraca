import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../src/db.js';
import { buildApp } from '../../src/server.js';
import { createEvent, loginAs, resetDb } from '../helpers.js';
import { getPage, line, ORG_A, postForm, SEED_PASSWORD, userId } from './_support.js';

async function eventRow(id: string) {
  return (await query('SELECT status, published_at, updated_at, name, capacity FROM events WHERE id = $1', [id])).rows[0];
}

describe('F04 publicação', () => {
  let app: FastifyInstance;
  let cookieA: string;
  let orgA: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
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

  it('C-F04-21 publicação aceita só rascunho', async () => {
    const draft = await createEvent({ organizerId: orgA, status: 'draft', name: 'Rascunho' });
    expect((await eventRow(draft.id)).published_at).toBeNull();

    const res = await postForm(app, `/org/events/${draft.id}/publish`, cookieA);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/org/events/${draft.id}`);
    const pub = await eventRow(draft.id);
    expect(pub.status).toBe('published');
    expect(pub.published_at).toBeInstanceOf(Date);
    expect((await getPage(app, '/')).body).toContain(`data-event-id="${draft.id}"`);
    const manage = await getPage(app, `/org/events/${draft.id}`, cookieA);
    expect(manage.body).not.toContain('data-form="publish"');
    expect(manage.body).toContain('data-form="edit"');

    const again = await postForm(app, `/org/events/${draft.id}/publish`, cookieA);
    expect(again.statusCode).toBe(409);
    expect(line(again.body, 'data-flash="error"')).toContain('O evento já está publicado.');
    expect(await eventRow(draft.id)).toEqual(pub);

    const cancelled = await createEvent({ organizerId: orgA, status: 'cancelled' });
    const beforeCancelled = await eventRow(cancelled.id);
    const rej = await postForm(app, `/org/events/${cancelled.id}/publish`, cookieA);
    expect(rej.statusCode).toBe(409);
    expect(line(rej.body, 'data-flash="error"')).toContain('Evento cancelado não pode ser publicado.');
    expect(await eventRow(cancelled.id)).toEqual(beforeCancelled);
  });

  it('C-F04-21 duas publicações simultâneas resultam em uma 303 e uma 409', async () => {
    const draft = await createEvent({ organizerId: orgA, status: 'draft' });
    const results = await Promise.all([
      postForm(app, `/org/events/${draft.id}/publish`, cookieA),
      postForm(app, `/org/events/${draft.id}/publish`, cookieA),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([303, 409]);
    expect((await eventRow(draft.id)).status).toBe('published');
  });
});
