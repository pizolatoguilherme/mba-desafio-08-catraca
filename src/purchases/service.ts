import type pg from 'pg';
import { query, withTransaction } from '../db.js';
import { getSeatCounts, lockEvent } from '../events/repo.js';
import type { TicketStatus } from '../format.js';
import { cardLast4, isValidCardNumber } from '../gateway/card.js';
import { enqueuePayment } from '../gateway/dispatcher.js';
import { dispatcher } from '../gateway/index.js';
import { newId, newTicketCode } from '../ids.js';

/** Linha da tabela tickets (architecture.md §3). F06/F07/F08 importam daqui. */
export interface TicketRow {
  id: string;
  event_id: string;
  user_id: string | null;
  buyer_email: string;
  channel: 'web' | 'partner';
  code: string;
  status: TicketStatus;
  price_cents: number;
  card_last4: string;
  checked_in_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type PurchaseError = 'invalid_request' | 'event_not_available' | 'sold_out';

export type PurchaseResult =
  | { ok: true; ticket: { id: string; code: string; status: 'pending'; eventId: string } }
  | { ok: false; error: PurchaseError };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_CODE_ATTEMPTS = 5;

/**
 * ok só se buyerEmail é string (≤ 254, formato a@b.c) e cardNumber é string de exatamente 16 dígitos.
 * Sem trim nem normalização.
 */
export function validatePurchaseInput(i: {
  buyerEmail: unknown;
  cardNumber: unknown;
}): { ok: true } | { ok: false; error: 'invalid_request' } {
  const { buyerEmail, cardNumber } = i;
  const emailOk = typeof buyerEmail === 'string' && buyerEmail.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(buyerEmail);
  const cardOk = typeof cardNumber === 'string' && isValidCardNumber(cardNumber);
  return emailOk && cardOk ? { ok: true } : { ok: false, error: 'invalid_request' };
}

/**
 * INSERT do ingresso com código novo; em colisão (ON CONFLICT (code) DO NOTHING, que não aborta a
 * transação) tenta outro código, até 5 vezes. Interno: exportado só para teste.
 */
export async function insertTicketWithUniqueCode(
  c: pg.PoolClient,
  row: Omit<TicketRow, 'code' | 'status' | 'checked_in_at' | 'created_at' | 'updated_at'>,
  genCode: () => string = newTicketCode,
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const r = await c.query<{ id: string; code: string }>(
      `INSERT INTO tickets (id, event_id, user_id, buyer_email, channel, code, price_cents, card_last4)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (code) DO NOTHING
       RETURNING id, code`,
      [row.id, row.event_id, row.user_id, row.buyer_email, row.channel, genCode(), row.price_cents, row.card_last4],
    );
    if (r.rows[0]) return r.rows[0];
  }
  throw new Error(`insertTicketWithUniqueCode: ${MAX_CODE_ATTEMPTS} colisões seguidas de código`);
}

/**
 * Compra de 1 ingresso (R06/R07). Ordem fixa (AC-F05-12):
 * validação -> tx { lockEvent (FOR UPDATE na linha do evento); status; getSeatCounts(c) depois do lock;
 * INSERT ticket (price_cents do evento travado); enqueuePayment } -> COMMIT -> dispatcher.kick().
 * Em READ COMMITTED cada statement tira um snapshot novo: a contagem, feita depois de obter o lock,
 * enxerga os ingressos de todas as compras que seguraram o lock antes (ver spec §8.1).
 */
export async function purchaseTicket(i: {
  eventId: string;
  channel: 'web' | 'partner';
  userId?: string | null;
  buyerEmail: string;
  cardNumber: string;
}): Promise<PurchaseResult> {
  if (!validatePurchaseInput(i).ok) return { ok: false, error: 'invalid_request' };
  const last4 = cardLast4(i.cardNumber);

  const result = await withTransaction<PurchaseResult>(async (c) => {
    const ev = await lockEvent(c, i.eventId);
    if (!ev || ev.status !== 'published') return { ok: false, error: 'event_not_available' };
    const seats = await getSeatCounts(c, i.eventId);
    if (seats.available <= 0) return { ok: false, error: 'sold_out' };
    const ticket = await insertTicketWithUniqueCode(c, {
      id: newId('tkt'),
      event_id: ev.id,
      user_id: i.channel === 'web' ? (i.userId ?? null) : null,
      buyer_email: i.buyerEmail,
      channel: i.channel,
      price_cents: ev.price_cents,
      card_last4: last4,
    });
    await enqueuePayment(c, ticket.id, last4);
    return { ok: true, ticket: { id: ticket.id, code: ticket.code, status: 'pending', eventId: ev.id } };
  });

  // Depois do COMMIT: o dispatcher já enxerga a linha de payments.
  if (result.ok) dispatcher.kick();
  return result;
}

export async function findTicketById(id: string): Promise<TicketRow | null> {
  const r = await query<TicketRow>('SELECT * FROM tickets WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

/** Normaliza com trim().toUpperCase(). */
export async function findTicketByCode(code: string): Promise<TicketRow | null> {
  const r = await query<TicketRow>('SELECT * FROM tickets WHERE code = $1', [String(code).trim().toUpperCase()]);
  return r.rows[0] ?? null;
}

/** Ingressos do participante (canal web), mais recentes primeiro. Ingressos de parceiro (user_id null) nunca aparecem. */
export async function listTicketsForUser(userId: string): Promise<Array<TicketRow & { event_name: string }>> {
  const r = await query<TicketRow & { event_name: string }>(
    `SELECT t.*, e.name AS event_name
       FROM tickets t JOIN events e ON e.id = t.event_id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC, t.id`,
    [userId],
  );
  return r.rows;
}
