import type pg from 'pg';
import type { Db } from '../db.js';

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

function todo(): never {
  throw new Error('F04: não implementado');
}

export async function lockEvent(_c: pg.PoolClient, _id: string): Promise<EventRow | null> {
  return todo();
}

export async function getSeatCounts(_db: Db, _eventId: string): Promise<{ capacity: number; occupied: number; available: number }> {
  return todo();
}

export async function listOnSaleEvents(_db?: Db): Promise<Array<EventRow & { available: number }>> {
  return todo();
}

export async function getOwnedEvent(_organizerId: string, _id: string): Promise<EventRow | null> {
  return todo();
}

export async function getPublicEvent(_id: string): Promise<EventRow | null> {
  return todo();
}
