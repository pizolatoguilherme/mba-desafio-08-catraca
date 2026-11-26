// Helpers de teste compartilhados (F01). F02 acrescenta loginAs neste arquivo.
import { hashPassword } from '../src/auth/password.js';
import { query } from '../src/db.js';
import type { TicketStatus } from '../src/format.js';
import { newId, newTicketCode } from '../src/ids.js';
import { runSeed } from '../src/seed.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** TRUNCATE de todas as tabelas (exceto schema_migrations) e recarga da seed. */
export async function resetDb(): Promise<void> {
  await query('TRUNCATE users, sessions, events, tickets, payments RESTART IDENTITY CASCADE');
  await runSeed();
}

/** Defaults: email "u-<10 chars>@example.com", password "senha123", name "Usuário Teste". */
export async function createUser(p: {
  role: 'participant' | 'organizer';
  email?: string;
  password?: string;
  name?: string;
}): Promise<{ id: string; email: string; password: string }> {
  const id = newId('usr');
  const email = p.email ?? `u-${newId('usr').slice(4)}@example.com`;
  const password = p.password ?? 'senha123';
  const name = p.name ?? 'Usuário Teste';
  await query('INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)', [
    id,
    name,
    email,
    await hashPassword(password),
    p.role,
  ]);
  return { id, email, password };
}

/**
 * Defaults: status 'published' (published_at = now()), capacity 10, priceCents 10000,
 * startsAt = agora + 30 dias, name "Evento Teste", venue "Local Teste".
 * 'cancelled' preenche published_at e cancelled_at.
 */
export async function createEvent(p: {
  organizerId: string;
  status?: 'draft' | 'published' | 'cancelled';
  capacity?: number;
  priceCents?: number;
  startsAt?: Date;
  name?: string;
  venue?: string;
}): Promise<{ id: string }> {
  const id = newId('evt');
  const status = p.status ?? 'published';
  await query(
    `INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents, status, published_at, cancelled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text,
             CASE WHEN $8::text IN ('published', 'cancelled') THEN now() END,
             CASE WHEN $8::text = 'cancelled' THEN now() END)`,
    [
      id,
      p.organizerId,
      p.name ?? 'Evento Teste',
      p.venue ?? 'Local Teste',
      p.startsAt ?? new Date(Date.now() + 30 * DAY_MS),
      p.capacity ?? 10,
      p.priceCents ?? 10000,
      status,
    ],
  );
  return { id };
}

/**
 * Defaults: status 'pending', priceCents = preço atual do evento, channel 'web', userId null,
 * buyerEmail "comprador@example.com", code newTicketCode(), card_last4 '0001', checkedIn false.
 * Só grava em tickets (não cria linha em payments).
 */
export async function insertTicket(p: {
  eventId: string;
  status?: TicketStatus;
  priceCents?: number;
  channel?: 'web' | 'partner';
  userId?: string | null;
  buyerEmail?: string;
  code?: string;
  checkedIn?: boolean;
}): Promise<{ id: string; code: string }> {
  const id = newId('tkt');
  const code = p.code ?? newTicketCode();
  let priceCents = p.priceCents;
  if (priceCents === undefined) {
    const ev = await query<{ price_cents: number }>('SELECT price_cents FROM events WHERE id = $1', [p.eventId]);
    if (ev.rowCount === 0) throw new Error(`insertTicket: evento ${p.eventId} não existe`);
    priceCents = ev.rows[0].price_cents;
  }
  await query(
    `INSERT INTO tickets (id, event_id, user_id, buyer_email, channel, code, status, price_cents, card_last4, checked_in_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '0001', CASE WHEN $9::boolean THEN now() END)`,
    [
      id,
      p.eventId,
      p.userId ?? null,
      p.buyerEmail ?? 'comprador@example.com',
      p.channel ?? 'web',
      code,
      p.status ?? 'pending',
      priceCents,
      p.checkedIn ?? false,
    ],
  );
  return { id, code };
}
