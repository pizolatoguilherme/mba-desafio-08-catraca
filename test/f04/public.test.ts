import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listOnSaleEvents } from '../../src/events/repo.js';
import { buildApp } from '../../src/server.js';
import { createEvent, createUser, insertTicket, loginAs, resetDb } from '../helpers.js';
import { block, field, getPage, PARTICIPANT, SEED_PASSWORD } from './_support.js';

describe('F04 vitrine e página pública', () => {
  let app: FastifyInstance;
  let org: string;

  beforeAll(async () => {
    app = await buildApp({ startDispatcher: false });
    await app.ready();
  });

  beforeEach(async () => {
    await resetDb();
    org = (await createUser({ role: 'organizer' })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('C-F04-06 vitrine lista publicados com nome, data, local, preço e vagas', async () => {
    const ev = await createEvent({
      organizerId: org,
      name: 'Jazz no Porão',
      venue: 'Bar do Porão',
      capacity: 3,
      priceCents: 10000,
      startsAt: new Date('2026-12-25T23:00:00Z'),
    });
    await insertTicket({ eventId: ev.id, status: 'confirmed' });
    await insertTicket({ eventId: ev.id, status: 'declined' });
    const other = await createEvent({ organizerId: org, name: 'Outro', startsAt: new Date('2026-12-20T23:00:00Z') });

    for (const cookie of [null, await loginAs(app, PARTICIPANT, SEED_PASSWORD)]) {
      const res = await getPage(app, '/', cookie);
      expect(res.statusCode).toBe(200);
      const html = res.body;
      expect(html).toContain('data-list="showcase"');
      const b = block(html, ev.id);
      expect(b).toContain(`href="/events/${ev.id}"`);
      expect(field(html, ev.id, 'name')).toContain('data-field="name">Jazz no Porão<');
      expect(field(html, ev.id, 'startsAt')).toContain('data-field="startsAt">25/12/2026 20:00<');
      expect(field(html, ev.id, 'venue')).toContain('data-field="venue">Bar do Porão<');
      expect(field(html, ev.id, 'price')).toContain('data-field="price">R$ 100,00<');
      expect(field(html, ev.id, 'available')).toContain('data-field="available">2<');
      // Ordenada por data: o evento de 20/12 vem antes.
      expect(html.indexOf(`data-event-id="${other.id}"`)).toBeLessThan(html.indexOf(`data-event-id="${ev.id}"`));
    }
  });

  it('C-F04-06 vitrine vazia mostra a mensagem de nenhum evento', async () => {
    await createEvent({ organizerId: org, status: 'draft' });
    const res = await getPage(app, '/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Nenhum evento à venda no momento.');
    expect(res.body).not.toContain('data-event-id=');
  });

  it('C-F04-04 rascunho e cancelado ficam fora da vitrine e respondem 404', async () => {
    const draft = await createEvent({ organizerId: org, status: 'draft', name: 'Rascunho Secreto' });
    const cancelled = await createEvent({ organizerId: org, status: 'cancelled', name: 'Cancelado Secreto' });
    const pub = await createEvent({ organizerId: org, name: 'Publicado Visível' });

    const home = await getPage(app, '/');
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain(`data-event-id="${pub.id}"`);
    for (const [id, name] of [
      [draft.id, 'Rascunho Secreto'],
      [cancelled.id, 'Cancelado Secreto'],
    ]) {
      expect(home.body).not.toContain(`data-event-id="${id}"`);
      const page = await getPage(app, `/events/${id}`);
      expect(page.statusCode).toBe(404);
      expect(page.body).not.toContain(name);
      expect(page.body).toContain('data-error-status="404"');
    }
    const missing = await getPage(app, '/events/evt_naoexiste');
    expect(missing.statusCode).toBe(404);

    const onSale = (await listOnSaleEvents()).map((e) => e.id);
    expect(onSale).toEqual([pub.id]);
    expect(onSale).not.toContain(draft.id);
    expect(onSale).not.toContain(cancelled.id);
  });

  it('C-F04-06 página do evento inclui o slot de compra', async () => {
    const ev = await createEvent({ organizerId: org, name: 'Jazz no Porão', venue: 'Bar do Porão', capacity: 2, priceCents: 15000 });
    await insertTicket({ eventId: ev.id, status: 'pending' });
    const res = await getPage(app, `/events/${ev.id}`);
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toContain(`<article data-event-id="${ev.id}">`);
    expect(html).toContain('<h1 data-field="name">Jazz no Porão</h1>');
    expect(field(html, null, 'venue')).toContain('>Bar do Porão<');
    expect(field(html, null, 'price')).toContain('>R$ 150,00<');
    expect(field(html, null, 'available')).toContain('>1<');
    expect(field(html, null, 'startsAt')).toMatch(/>\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}</);
    expect(html).toContain('<section data-slot="buy">');
  });
});
