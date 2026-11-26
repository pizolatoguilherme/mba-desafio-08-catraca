/**
 * Script de demonstração/verificação de F03 (usado só na avaliação de F03, XC-F03-F01-01).
 *
 *   node dist/gateway/enqueue-demo.js [--card <16 dígitos>] [--count <1..50>] [--rounds <1..20>]
 *                                     [--no-wait] [--timeout-ms <ms>]
 *
 * Cria um evento 'draft' do organizador A da seed, grava tickets 'pending' + enqueuePayment e
 * acompanha o status. NÃO inicia dispatcher nem faz kick(): quem processa é o dispatcher do servidor.
 * Saída: uma linha JSON por ticket. Código 0 (todos finais ou --no-wait), 1 (timeout), 2 (uso/seed).
 */
import { pathToFileURL } from 'node:url';
import { pool, query, withTransaction } from '../db.js';
import type { TicketStatus } from '../format.js';
import { newId, newTicketCode } from '../ids.js';
import { cardLast4, isValidCardNumber } from './card.js';
import { enqueuePayment } from './dispatcher.js';

export interface DemoOptions {
  card: string;
  count: number;
  rounds: number;
  wait: boolean;
  timeoutMs: number;
}

export interface DemoLine {
  round: number;
  eventId: string;
  ticketId: string;
  last4: string;
  status: TicketStatus;
  elapsedMs: number;
}

/** Erro de uso ou de ambiente (código de saída 2). */
export class DemoUsageError extends Error {}

export const DEMO_DEFAULTS: DemoOptions = {
  card: '4000000000000001',
  count: 1,
  rounds: 1,
  wait: true,
  timeoutMs: 10000,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PRICE_CENTS = 1000;
const POLL_MS = 50;

function isIntIn(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

function validate(opts: DemoOptions): void {
  if (!isValidCardNumber(opts.card)) throw new DemoUsageError('cartão inválido: use 16 dígitos');
  if (!isIntIn(opts.count, 1, 50)) throw new DemoUsageError('--count fora do intervalo: use 1..50');
  if (!isIntIn(opts.rounds, 1, 20)) throw new DemoUsageError('--rounds fora do intervalo: use 1..20');
  if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs < 1) {
    throw new DemoUsageError('--timeout-ms inválido: use um inteiro >= 1');
  }
}

/** Lê os argumentos da linha de comando (sem o node e o script). Lança DemoUsageError. */
export function parseDemoArgs(argv: string[]): DemoOptions {
  const opts: DemoOptions = { ...DEMO_DEFAULTS };
  const intArg = (name: string, v: string | undefined): number => {
    if (v === undefined || !/^[0-9]+$/.test(v)) throw new DemoUsageError(`${name} exige um número inteiro`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--card':
        if (argv[i + 1] === undefined) throw new DemoUsageError('cartão inválido: use 16 dígitos');
        opts.card = argv[++i];
        break;
      case '--count':
        opts.count = intArg(a, argv[++i]);
        break;
      case '--rounds':
        opts.rounds = intArg(a, argv[++i]);
        break;
      case '--timeout-ms':
        opts.timeoutMs = intArg(a, argv[++i]);
        break;
      case '--no-wait':
        opts.wait = false;
        break;
      default:
        throw new DemoUsageError(`argumento desconhecido: ${a}`);
    }
  }
  validate(opts);
  return opts;
}

async function findOrganizerId(): Promise<string> {
  const r = await query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'organizer'
      ORDER BY (lower(email) = 'org.a@catraca.dev') DESC, created_at, id LIMIT 1`,
  );
  if (r.rowCount === 0) throw new DemoUsageError('nenhum organizador encontrado: rode a seed');
  return r.rows[0].id;
}

function isCodeCollision(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && e.constraint === 'tickets_code_key';
}

/** Uma transação: INSERT do ticket pending + enqueuePayment. Resolve depois do commit. */
async function enqueueOne(eventId: string, last4: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const ticketId = newId('tkt');
    try {
      await withTransaction(async (c) => {
        await c.query(
          `INSERT INTO tickets (id, event_id, user_id, buyer_email, channel, code, status, price_cents, card_last4)
           VALUES ($1, $2, NULL, 'demo-f03@example.com', 'partner', $3, 'pending', $4, $5)`,
          [ticketId, eventId, newTicketCode(), PRICE_CENTS, last4],
        );
        await enqueuePayment(c, ticketId, last4);
      });
      return ticketId;
    } catch (err) {
      if (attempt < 5 && isCodeCollision(err)) continue;
      throw err;
    }
  }
}

async function waitFinal(
  ticketIds: string[],
  committedAt: Map<string, number>,
  timeoutMs: number,
): Promise<Map<string, { status: TicketStatus; elapsedMs: number }>> {
  const out = new Map<string, { status: TicketStatus; elapsedMs: number }>();
  const deadline = Math.max(...ticketIds.map((id) => committedAt.get(id)!)) + timeoutMs;
  for (;;) {
    const open = ticketIds.filter((id) => !out.has(id));
    const r = await query<{ id: string; status: TicketStatus }>('SELECT id, status FROM tickets WHERE id = ANY($1)', [
      open,
    ]);
    const now = performance.now();
    for (const row of r.rows) {
      if (row.status !== 'pending') out.set(row.id, { status: row.status, elapsedMs: Math.round(now - committedAt.get(row.id)!) });
    }
    if (out.size === ticketIds.length) return out;
    if (now >= deadline) {
      for (const id of ticketIds) {
        if (!out.has(id)) out.set(id, { status: 'pending', elapsedMs: Math.round(now - committedAt.get(id)!) });
      }
      return out;
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

export async function runDemo(opts: DemoOptions, onLine?: (l: DemoLine) => void): Promise<DemoLine[]> {
  validate(opts);
  const last4 = cardLast4(opts.card);
  const organizerId = await findOrganizerId();

  const eventId = newId('evt');
  await query(
    `INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents, status)
     VALUES ($1, $2, $3, 'Gateway simulado', $4, $5, $6, 'draft')`,
    [
      eventId,
      organizerId,
      `Demo F03 ${new Date().toISOString()}`,
      new Date(Date.now() + 30 * DAY_MS),
      Math.max(1, opts.count * opts.rounds),
      PRICE_CENTS,
    ],
  );

  const lines: DemoLine[] = [];
  for (let round = 1; round <= opts.rounds; round++) {
    const committedAt = new Map<string, number>();
    const ticketIds = await Promise.all(
      Array.from({ length: opts.count }, async () => {
        const id = await enqueueOne(eventId, last4);
        committedAt.set(id, performance.now());
        return id;
      }),
    );

    const finals = opts.wait
      ? await waitFinal(ticketIds, committedAt, opts.timeoutMs)
      : new Map(ticketIds.map((id) => [id, { status: 'pending' as TicketStatus, elapsedMs: 0 }]));

    for (const ticketId of ticketIds) {
      const f = finals.get(ticketId)!;
      const line: DemoLine = { round, eventId, ticketId, last4, status: f.status, elapsedMs: f.elapsedMs };
      lines.push(line);
      onLine?.(line);
    }
  }
  return lines;
}

// Execução direta: node dist/gateway/enqueue-demo.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void (async () => {
    try {
      const opts = parseDemoArgs(process.argv.slice(2));
      const lines = await runDemo(opts, (l) => process.stdout.write(`${JSON.stringify(l)}\n`));
      process.exitCode = opts.wait && lines.some((l) => l.status === 'pending') ? 1 : 0;
    } catch (err) {
      if (err instanceof DemoUsageError) {
        console.error(err.message);
        process.exitCode = 2;
      } else {
        console.error('enqueue-demo falhou:', (err as Error).message);
        process.exitCode = 1;
      }
    } finally {
      await pool.end();
    }
  })();
}
