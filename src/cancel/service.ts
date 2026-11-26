// F08: cancelamento de evento (R11).
import { withTransaction } from '../db.js';
import { lockEvent } from '../events/repo.js';

export type CancelResult = { ok: true } | { ok: false; error: 'not_found' | 'not_cancellable' };

/**
 * Cancelamento irreversível de um evento publicado do organizador (R11), numa única transação:
 *   1. lockEvent (SELECT … FOR UPDATE): serializa com a compra (FOR UPDATE), com applyGatewayResult
 *      e com o check-in (FOR SHARE no evento);
 *   2. inexistente ou de outro dono -> not_found (R13: não revela que o evento existe);
 *   3. status <> 'published' (rascunho ou já cancelado) -> not_cancellable, sem efeito;
 *   4. evento -> 'cancelled' e, num ÚNICO UPDATE, confirmed -> refunded e pending -> cancelled.
 * payments não é tocado: a resposta do gateway que chegar depois encontra o evento cancelado e o
 * ticket fora de 'pending', e applyGatewayResult (F03) não muda nada.
 */
export async function cancelEvent(organizerId: string, eventId: string): Promise<CancelResult> {
  return withTransaction<CancelResult>(async (c) => {
    const ev = await lockEvent(c, eventId);
    if (!ev || ev.organizer_id !== organizerId) return { ok: false, error: 'not_found' };
    if (ev.status !== 'published') return { ok: false, error: 'not_cancellable' };
    await c.query(
      "UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1",
      [eventId],
    );
    await c.query(
      `UPDATE tickets
          SET status = CASE status WHEN 'confirmed' THEN 'refunded' WHEN 'pending' THEN 'cancelled' END,
              updated_at = now()
        WHERE event_id = $1 AND status IN ('confirmed', 'pending')`,
      [eventId],
    );
    return { ok: true };
  });
}
