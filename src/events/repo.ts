import type pg from 'pg';
import { pool, query, withTransaction, type Db } from '../db.js';
import { newId } from '../ids.js';

export interface EventRow {
  id: string;
  organizer_id: string;
  name: string;
  venue: string;
  starts_at: Date;
  capacity: number;
  price_cents: number;
  status: 'draft' | 'published' | 'cancelled';
}

export type EventInput = { name: string; venue: string; startsAt: Date; capacity: number; priceCents: number };

const EVENT_COLUMNS = 'e.id, e.organizer_id, e.name, e.venue, e.starts_at, e.capacity, e.price_cents, e.status';

// Vagas ocupadas (R05): tickets pending + confirmed. Disponíveis: 0 em evento cancelado.
const OCCUPIED_SQL = "count(t.id) FILTER (WHERE t.status IN ('pending', 'confirmed'))::int";
const AVAILABLE_SQL = `CASE WHEN e.status = 'cancelled' THEN 0 ELSE greatest(0, e.capacity - ${OCCUPIED_SQL}) END::int`;

/** SELECT … FOR UPDATE do evento, dentro da transação do client. Id inexistente -> null. */
export async function lockEvent(c: pg.PoolClient, id: string): Promise<EventRow | null> {
  const r = await c.query<EventRow>(`SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = $1 FOR UPDATE`, [id]);
  return r.rows[0] ?? null;
}

/** occupied = pending + confirmed; available = cancelled ? 0 : max(0, capacity - occupied). Inexistente -> zeros. */
export async function getSeatCounts(db: Db, eventId: string): Promise<{ capacity: number; occupied: number; available: number }> {
  const r = await db.query<{ capacity: number; occupied: number; available: number }>(
    `SELECT e.capacity, ${OCCUPIED_SQL} AS occupied, ${AVAILABLE_SQL} AS available
       FROM events e LEFT JOIN tickets t ON t.event_id = e.id
      WHERE e.id = $1
      GROUP BY e.id`,
    [eventId],
  );
  return r.rows[0] ?? { capacity: 0, occupied: 0, available: 0 };
}

/** Eventos à venda (status published), ORDER BY starts_at, id, com as vagas disponíveis. */
export async function listOnSaleEvents(db: Db = pool): Promise<Array<EventRow & { available: number }>> {
  const r = await db.query<EventRow & { available: number }>(
    `SELECT ${EVENT_COLUMNS}, ${AVAILABLE_SQL} AS available
       FROM events e LEFT JOIN tickets t ON t.event_id = e.id
      WHERE e.status = 'published'
      GROUP BY e.id
      ORDER BY e.starts_at, e.id`,
  );
  return r.rows;
}

/** Evento do organizador (qualquer status); de outro dono ou inexistente -> null. */
export async function getOwnedEvent(organizerId: string, id: string): Promise<EventRow | null> {
  const r = await query<EventRow>(`SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = $1 AND e.organizer_id = $2`, [
    id,
    organizerId,
  ]);
  return r.rows[0] ?? null;
}

/** Só eventos publicados; rascunho, cancelado ou inexistente -> null. */
export async function getPublicEvent(id: string): Promise<EventRow | null> {
  const r = await query<EventRow>(`SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = $1 AND e.status = 'published'`, [id]);
  return r.rows[0] ?? null;
}

/** Eventos do organizador (todos os status), ORDER BY starts_at, id, com as vagas disponíveis. */
export async function listOwnedEvents(organizerId: string): Promise<Array<EventRow & { available: number }>> {
  const r = await query<EventRow & { available: number }>(
    `SELECT ${EVENT_COLUMNS}, ${AVAILABLE_SQL} AS available
       FROM events e LEFT JOIN tickets t ON t.event_id = e.id
      WHERE e.organizer_id = $1
      GROUP BY e.id
      ORDER BY e.starts_at, e.id`,
    [organizerId],
  );
  return r.rows;
}

/** Cria o evento como rascunho (status default 'draft' do schema). */
export async function createOwnedEvent(organizerId: string, v: EventInput): Promise<EventRow> {
  const r = await query<EventRow>(
    `INSERT INTO events AS e (id, organizer_id, name, venue, starts_at, capacity, price_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${EVENT_COLUMNS}`,
    [newId('evt'), organizerId, v.name, v.venue, v.startsAt, v.capacity, v.priceCents],
  );
  return r.rows[0];
}

/**
 * Edição sob lock (R03): dono e status relidos sob FOR UPDATE; lotação < vagas ocupadas -> erro.
 * Grava name, venue, starts_at, capacity, price_cents e updated_at; não toca em tickets.
 */
export async function updateOwnedEvent(
  organizerId: string,
  id: string,
  v: EventInput,
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'cancelled' | 'capacity_below_occupied'; occupied?: number }> {
  return withTransaction(async (c) => {
    const ev = await lockEvent(c, id);
    if (!ev || ev.organizer_id !== organizerId) return { ok: false, error: 'not_found' } as const;
    if (ev.status === 'cancelled') return { ok: false, error: 'cancelled' } as const;
    const { occupied } = await getSeatCounts(c, id);
    if (v.capacity < occupied) return { ok: false, error: 'capacity_below_occupied', occupied } as const;
    await c.query(
      `UPDATE events
          SET name = $2, venue = $3, starts_at = $4, capacity = $5, price_cents = $6, updated_at = now()
        WHERE id = $1`,
      [id, v.name, v.venue, v.startsAt, v.capacity, v.priceCents],
    );
    return { ok: true } as const;
  });
}

/** Publicação sob lock: só a partir de 'draft'. */
export async function publishOwnedEvent(
  organizerId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'cancelled' | 'not_draft' }> {
  return withTransaction(async (c) => {
    const ev = await lockEvent(c, id);
    if (!ev || ev.organizer_id !== organizerId) return { ok: false, error: 'not_found' } as const;
    if (ev.status === 'cancelled') return { ok: false, error: 'cancelled' } as const;
    if (ev.status !== 'draft') return { ok: false, error: 'not_draft' } as const;
    await c.query(
      "UPDATE events SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1",
      [id],
    );
    return { ok: true } as const;
  });
}
