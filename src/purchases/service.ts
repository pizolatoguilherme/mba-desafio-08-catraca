import type { TicketStatus } from '../format.js';

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
