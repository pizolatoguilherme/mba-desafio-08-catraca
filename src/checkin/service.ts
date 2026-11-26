// F07: check-in (R10).
import { withTransaction } from '../db.js';

/** Mensagens literais de R10 (docs/brief.md). */
export const CHECKIN_MESSAGES = {
  invalid: 'Ingresso inválido para este evento',
  cancelled: 'Evento cancelado',
  notConfirmed: 'Ingresso não confirmado',
  used: 'Ingresso já utilizado',
  ok: 'Entrada liberada',
} as const;

export type CheckinResult = keyof typeof CHECKIN_MESSAGES;

/**
 * Normalização do código (D3): trim + maiúsculas. Espaços internos não são removidos.
 * Entrada que não é string, ou vazia depois do trim, -> null. Interno: exportado para os testes.
 */
export function normalizeCode(rawCode: unknown): string | null {
  if (typeof rawCode !== 'string') return null;
  const code = rawCode.trim().toUpperCase();
  return code === '' ? null : code;
}

/**
 * Check-in de um código no evento, com a ordem de R10 (D2): a primeira situação verdadeira vence.
 *   1. ticket não encontrado para (code, event_id) -> 'invalid' (evento inexistente também)
 *   2. evento cancelado                             -> 'cancelled'
 *   3. ticket com status <> 'confirmed'             -> 'notConfirmed'
 *   4. checked_in_at preenchido                     -> 'used'
 *   5. senão                                        -> 'ok' (grava checked_in_at; status não muda)
 * Locks (D1, architecture §8 #13): evento FOR SHARE e depois ticket FOR UPDATE. O FOR UPDATE serializa
 * check-ins concorrentes do mesmo código; o FOR SHARE serializa com o cancelamento (F08).
 * Não verifica o dono do evento: a rota garante isso.
 */
export async function checkIn(eventId: string, rawCode: string): Promise<CheckinResult> {
  const code = normalizeCode(rawCode);
  if (code === null) return 'invalid';

  return withTransaction(async (c) => {
    const ev = await c.query<{ status: string }>('SELECT status FROM events WHERE id = $1 FOR SHARE', [eventId]);
    if (ev.rowCount === 0) return 'invalid';

    const t = await c.query<{ id: string; status: string; checked_in_at: Date | null }>(
      'SELECT id, status, checked_in_at FROM tickets WHERE code = $1 AND event_id = $2 FOR UPDATE',
      [code, eventId],
    );
    if (t.rowCount === 0) return 'invalid';
    if (ev.rows[0].status === 'cancelled') return 'cancelled';
    const ticket = t.rows[0];
    if (ticket.status !== 'confirmed') return 'notConfirmed';
    if (ticket.checked_in_at !== null) return 'used';

    await c.query('UPDATE tickets SET checked_in_at = now(), updated_at = now() WHERE id = $1', [ticket.id]);
    return 'ok';
  });
}
