// F07: painel do evento (R12).
import type { Db } from '../db.js';

export interface Panel {
  confirmed: number;
  pending: number;
  checkins: number;
  available: number;
  revenueCents: number;
  refunded: number;
}

/** Esqueleto: a implementação real chega na etapa 2 do plano. */
export async function getPanel(db: Db, eventId: string): Promise<Panel> {
  void db;
  void eventId;
  return { confirmed: 0, pending: 0, checkins: 0, available: 0, revenueCents: 0, refunded: 0 };
}
