export type TicketStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'refunded';

const TIME_ZONE = 'America/Sao_Paulo';

/** 35000 -> "R$ 350,00"; 123456 -> "R$ 1.234,56". Espaço comum (U+0020), nunca NBSP. */
export function formatBRL(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100);
  const centavos = abs % 100;
  const inteiro = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${inteiro},${String(centavos).padStart(2, '0')}`;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(ms: number): LocalParts {
  const p: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Diferença (em minutos) entre a hora local de America/Sao_Paulo e UTC no instante ms. */
function offsetMinutes(ms: number): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const l = localParts(whole);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second);
  return Math.round((asUtc - whole) / 60_000);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Em America/Sao_Paulo: 2026-12-06T00:00:00Z -> "2026-12-05T21:00:00-03:00". */
export function toIsoWithOffset(d: Date): string {
  const ms = d.getTime();
  const l = localParts(ms);
  const off = offsetMinutes(ms);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return (
    `${pad(l.year, 4)}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}:${pad(l.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * "YYYY-MM-DDTHH:mm" ou "YYYY-MM-DDTHH:mm:ss" (valor de <input type="datetime-local">)
 * interpretado em America/Sao_Paulo. Formato errado ou data/hora inexistente -> null.
 */
export function parseLocalDateTime(s: string): Date | null {
  if (typeof s !== 'string') return null;
  const m = LOCAL_DATETIME.exec(s.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let ms = wallAsUtc - offsetMinutes(wallAsUtc) * 60_000;
  ms = wallAsUtc - offsetMinutes(ms) * 60_000; // ajuste perto de mudanças de offset
  const back = localParts(ms);
  if (
    back.year !== year || back.month !== month || back.day !== day ||
    back.hour !== hour || back.minute !== minute || back.second !== second
  ) {
    return null; // hora inexistente no fuso (ex.: lacuna de horário de verão)
  }
  return new Date(ms);
}

const PRICE = /^(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * "100,00" | "100.00" | "100" | "R$ 100,00" -> 10000; "150,5" -> 15050; "0" -> 0.
 * Inválido ("", "abc", "-1", "1.234,56", "10,999") -> null. A regra "> 0" é de quem valida o evento.
 */
export function parsePriceToCents(s: string): number | null {
  if (typeof s !== 'string') return null;
  let v = s.trim();
  if (v.startsWith('R$')) v = v.slice(2).trim();
  const m = PRICE.exec(v);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  pending: 'pendente',
  confirmed: 'confirmado',
  declined: 'recusado',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

/** pending->"pendente", confirmed->"confirmado", declined->"recusado", cancelled->"cancelado", refunded->"estornado". */
export function statusLabel(s: TicketStatus): string {
  return STATUS_LABELS[s];
}
