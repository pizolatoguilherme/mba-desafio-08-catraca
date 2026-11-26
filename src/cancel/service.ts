// F08: cancelamento de evento (R11).

export type CancelResult = { ok: true } | { ok: false; error: 'not_found' | 'not_cancellable' };

/** Esqueleto (etapa 1): a implementação transacional vem na etapa 2. */
export async function cancelEvent(organizerId: string, eventId: string): Promise<CancelResult> {
  void organizerId;
  void eventId;
  return { ok: false, error: 'not_found' };
}
