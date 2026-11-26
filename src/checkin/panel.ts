// F07: painel do evento (R12).
import type { Db } from '../db.js';
import { getSeatCounts } from '../events/repo.js';

export interface Panel {
  confirmed: number;
  pending: number;
  checkins: number;
  available: number;
  revenueCents: number;
  refunded: number;
}

// Uma consulta agregada (D5). Conta os tickets de todos os canais (web e partner). A receita é a soma
// do price_cents gravado em cada ingresso confirmado (R03), nunca events.price_cents × n.
// Os casts ::int evitam que o pg devolva COUNT/SUM (bigint) como string.
const PANEL_SQL = `SELECT
    COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
    COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
    COUNT(*) FILTER (WHERE status = 'confirmed' AND checked_in_at IS NOT NULL)::int AS checkins,
    COALESCE(SUM(price_cents) FILTER (WHERE status = 'confirmed'), 0)::int AS revenue_cents,
    COUNT(*) FILTER (WHERE status = 'refunded')::int AS refunded
  FROM tickets
  WHERE event_id = $1`;

interface PanelRow {
  confirmed: number;
  pending: number;
  checkins: number;
  revenue_cents: number;
  refunded: number;
}

/** Os seis números de R12. Vagas disponíveis vem de getSeatCounts (F04, R05; 0 em evento cancelado). */
export async function getPanel(db: Db, eventId: string): Promise<Panel> {
  const r = await db.query<PanelRow>(PANEL_SQL, [eventId]);
  const row = r.rows[0];
  const seats = await getSeatCounts(db, eventId);
  return {
    confirmed: row.confirmed,
    pending: row.pending,
    checkins: row.checkins,
    available: seats.available,
    revenueCents: row.revenue_cents,
    refunded: row.refunded,
  };
}
