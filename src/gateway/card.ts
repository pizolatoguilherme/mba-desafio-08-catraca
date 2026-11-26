/** Número de cartão válido: string com exatamente 16 dígitos ASCII (0-9). */
export function isValidCardNumber(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9]{16}$/.test(v);
}

/** Os 4 últimos dígitos do cartão (o único dado do cartão que é gravado). */
export function cardLast4(card: string): string {
  return card.slice(-4);
}
