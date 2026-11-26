export type ValidEventInput = { name: string; venue: string; startsAt: Date; capacity: number; priceCents: number };

export function validateEventInput(
  _form: Record<string, unknown>,
  _now: Date = new Date(),
): { ok: true; value: ValidEventInput } | { ok: false; errors: Record<string, string> } {
  throw new Error('F04: não implementado');
}
