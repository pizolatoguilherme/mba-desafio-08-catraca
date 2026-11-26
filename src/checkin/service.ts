// F07: check-in (R10).
export const CHECKIN_MESSAGES = {
  invalid: 'Ingresso inválido para este evento',
  cancelled: 'Evento cancelado',
  notConfirmed: 'Ingresso não confirmado',
  used: 'Ingresso já utilizado',
  ok: 'Entrada liberada',
} as const;

export type CheckinResult = keyof typeof CHECKIN_MESSAGES;

/** Esqueleto: a implementação real chega na etapa 4 do plano. */
export async function checkIn(eventId: string, rawCode: string): Promise<CheckinResult> {
  void eventId;
  void rawCode;
  return 'invalid';
}
