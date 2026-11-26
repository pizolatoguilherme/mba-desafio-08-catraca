import { query, withTransaction, type Db } from '../db.js';
import type { GatewayResult, PaymentGateway } from './simulated.js';

/**
 * Grava o pedido de pagamento (state 'requested') com o Db do chamador, normalmente a transação
 * da compra: ticket e pagamento são gravados juntos e um rollback desfaz os dois (R06).
 * Não chama o gateway nem kick(): o kick só pode acontecer depois do commit, pelo chamador.
 */
export async function enqueuePayment(c: Db, ticketId: string, cardLast4: string): Promise<void> {
  if (typeof cardLast4 !== 'string' || !/^[0-9]{4}$/.test(cardLast4)) {
    throw new TypeError('cardLast4 deve ter 4 dígitos');
  }
  await c.query('INSERT INTO payments (ticket_id, card_last4) VALUES ($1, $2)', [ticketId, cardLast4]);
}

/**
 * Aplica a resposta do gateway ao ticket (R08), com guarda (R11): só um ticket 'pending' de evento
 * não cancelado muda. O FOR SHARE no evento conflita com o FOR UPDATE do cancelamento (F08), então
 * as duas operações são serializadas; a ordem de lock é evento -> ticket, igual à da compra.
 * O pagamento termina 'done' mesmo quando a guarda recusa, para não ser reprocessado.
 * Retorna true só se o ticket foi alterado.
 */
export async function applyGatewayResult(ticketId: string, result: GatewayResult): Promise<boolean> {
  return withTransaction(async (c) => {
    const ev = await c.query<{ status: string }>(
      `SELECT e.status FROM tickets t JOIN events e ON e.id = t.event_id WHERE t.id = $1 FOR SHARE OF e`,
      [ticketId],
    );
    if (ev.rowCount === 0) return false;

    let changed = false;
    if (ev.rows[0].status !== 'cancelled') {
      const upd = await c.query(
        `UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1 AND status = 'pending'`,
        [ticketId, result === 'approved' ? 'confirmed' : 'declined'],
      );
      changed = upd.rowCount === 1;
    }
    await c.query(`UPDATE payments SET state = 'done', result = $2, completed_at = now() WHERE ticket_id = $1`, [
      ticketId,
      result,
    ]);
    return changed;
  });
}

export interface Dispatcher {
  start(): void;
  stop(): Promise<void>;
  kick(): void;
  idle(): Promise<void>;
}

const BATCH = 100;

const COLLECT_SQL = `UPDATE payments SET state = 'in_flight', started_at = now()
  WHERE id IN (SELECT id FROM payments WHERE state = 'requested' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT ${BATCH})
  RETURNING id, ticket_id, card_last4`;

const REQUEUE_SQL = `UPDATE payments SET state = 'requested', started_at = NULL WHERE ticket_id = $1 AND state = 'in_flight'`;

interface CollectedRow {
  id: string;
  ticket_id: string;
  card_last4: string;
}

/**
 * Processador assíncrono dos pagamentos: coleta as linhas 'requested' por polling (a cada pollMs)
 * ou por kick(), chama o gateway CONCORRENTEMENTE (uma promessa por pagamento, sem await em série)
 * e aplica cada resultado com applyGatewayResult.
 */
export function createDispatcher(opts: { gateway: PaymentGateway; pollMs: number }): Dispatcher {
  const { gateway, pollMs } = opts;

  let running = false;
  // Incrementada no stop(): resultados de autorizações de uma geração anterior são ignorados.
  let generation = 0;
  let timer: NodeJS.Timeout | null = null;
  let collecting: Promise<void> | null = null;
  let kickPending = false;
  // Autorização + aplicação da geração atual (para idle()).
  let inFlight = new Set<Promise<void>>();
  // Aplicações (transações no banco) já iniciadas, de qualquer geração (para stop() e idle()).
  const applying = new Set<Promise<void>>();

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNext(): void {
    if (!running || collecting || timer) return;
    timer = setTimeout(() => {
      timer = null;
      trigger();
    }, pollMs);
  }

  function track(set: Set<Promise<void>>, p: Promise<void>): void {
    set.add(p);
    void p.finally(() => set.delete(p));
  }

  async function settle(ticketId: string, result: GatewayResult): Promise<void> {
    try {
      await applyGatewayResult(ticketId, result);
    } catch (err) {
      console.error('[dispatcher] falha ao aplicar resultado', ticketId, err);
      await requeue(ticketId);
    }
  }

  async function requeue(ticketId: string): Promise<void> {
    try {
      await query(REQUEUE_SQL, [ticketId]);
    } catch (err) {
      console.error('[dispatcher] falha ao devolver pagamento para a fila', ticketId, err);
    }
  }

  function launch(row: CollectedRow, gen: number): void {
    // Promise.resolve().then: um gateway que lança de forma síncrona também cai no tratamento abaixo.
    const chain = Promise.resolve().then(() => gateway.authorize(row.card_last4)).then(
      (result) => {
        if (gen !== generation) return; // abandonada no stop(): fica in_flight e volta no próximo start()
        const p = settle(row.ticket_id, result);
        track(applying, p);
        return p;
      },
      (err: unknown) => {
        if (gen !== generation) return;
        console.error('[dispatcher] falha no gateway', row.ticket_id, err);
        const p = requeue(row.ticket_id);
        track(applying, p);
        return p;
      },
    );
    track(inFlight, chain);
  }

  async function cycle(gen: number): Promise<void> {
    do {
      kickPending = false;
      try {
        const { rows } = await query<CollectedRow>(COLLECT_SQL);
        if (gen !== generation) return; // parado durante a coleta: as linhas voltam no próximo start()
        for (const row of rows) launch(row, gen);
        if (rows.length >= BATCH) kickPending = true; // lote cheio: coleta de novo logo em seguida
      } catch (err) {
        console.error('[dispatcher] falha na coleta', err);
      }
    } while (running && gen === generation && kickPending);
  }

  function trigger(): void {
    if (!running) return;
    if (collecting) {
      kickPending = true; // coalescido: uma coleta extra logo depois da atual
      return;
    }
    clearTimer();
    collecting = cycle(generation).finally(() => {
      collecting = null;
      if (running && kickPending) trigger();
      else scheduleNext();
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      trigger();
    },

    async stop() {
      if (running) {
        running = false;
        generation++;
        kickPending = false;
        clearTimer();
        inFlight = new Set();
      }
      if (collecting) await collecting;
      await Promise.allSettled([...applying]);
    },

    kick() {
      trigger();
    },

    async idle() {
      for (;;) {
        const waits: Promise<void>[] = [...applying];
        if (collecting) waits.push(collecting);
        if (running) waits.push(...inFlight);
        if (waits.length === 0) return;
        await Promise.allSettled(waits);
      }
    },
  };
}
