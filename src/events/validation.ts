import { formatBRL, parseLocalDateTime, parsePriceToCents, toIsoWithOffset } from '../format.js';
import type { EventRow } from './repo.js';

export type ValidEventInput = { name: string; venue: string; startsAt: Date; capacity: number; priceCents: number };

export const EVENT_FIELDS = ['name', 'venue', 'startsAt', 'capacity', 'price'] as const;
export type EventField = (typeof EVENT_FIELDS)[number];
/** Valores (texto) de um formulário de evento, como aparecem nos inputs. */
export type EventFormValues = Record<EventField, string>;

export const MAX_TEXT_LENGTH = 200;
export const MAX_CAPACITY = 100_000;
export const MAX_PRICE_CENTS = 10_000_000; // R$ 100.000,00

export const MESSAGES = {
  nameRequired: 'Informe o nome do evento.',
  nameTooLong: 'O nome deve ter no máximo 200 caracteres.',
  venueRequired: 'Informe o local do evento.',
  venueTooLong: 'O local deve ter no máximo 200 caracteres.',
  startsAtRequired: 'Informe a data e hora de início.',
  startsAtInvalid: 'Data e hora de início inválidas.',
  startsAtPast: 'A data de início precisa estar no futuro.',
  capacityRequired: 'Informe a lotação.',
  capacityNotInteger: 'A lotação deve ser um número inteiro.',
  capacityTooSmall: 'A lotação deve ser de pelo menos 1.',
  capacityTooLarge: 'A lotação deve ser de no máximo 100000.',
  priceRequired: 'Informe o preço.',
  priceNotPositive: 'O preço deve ser maior que zero.',
  priceInvalid: 'Preço inválido. Use o formato 100,00.',
  priceTooLarge: 'O preço deve ser de no máximo R$ 100.000,00.',
} as const;

/** Mensagem da regra R03 (lotação abaixo das vagas ocupadas). */
export function capacityBelowOccupiedMessage(occupied: number): string {
  return `A lotação não pode ser menor que as vagas ocupadas (${occupied}).`;
}

/** Valores não-string (ausentes, arrays de campo duplicado) contam como ausentes. */
function text(form: Record<string, unknown>, key: string): string {
  const v = form[key];
  return typeof v === 'string' ? v : '';
}

const INTEGER = /^-?\d+$/;
const NUMERIC_PRICE = /^-?\d+([.,]\d{1,2})?$/;

/** Valida o formulário de evento (R01). Todas as mensagens são as da spec §8. */
export function validateEventInput(
  form: Record<string, unknown>,
  now: Date = new Date(),
): { ok: true; value: ValidEventInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const name = text(form, 'name').trim();
  if (!name) errors.name = MESSAGES.nameRequired;
  else if (name.length > MAX_TEXT_LENGTH) errors.name = MESSAGES.nameTooLong;

  const venue = text(form, 'venue').trim();
  if (!venue) errors.venue = MESSAGES.venueRequired;
  else if (venue.length > MAX_TEXT_LENGTH) errors.venue = MESSAGES.venueTooLong;

  const startsAtRaw = text(form, 'startsAt').trim();
  let startsAt: Date | null = null;
  if (!startsAtRaw) errors.startsAt = MESSAGES.startsAtRequired;
  else {
    startsAt = parseLocalDateTime(startsAtRaw);
    if (!startsAt) errors.startsAt = MESSAGES.startsAtInvalid;
    else if (startsAt.getTime() <= now.getTime()) errors.startsAt = MESSAGES.startsAtPast;
  }

  const capacityRaw = text(form, 'capacity').trim();
  let capacity = 0;
  if (!capacityRaw) errors.capacity = MESSAGES.capacityRequired;
  else if (!INTEGER.test(capacityRaw)) errors.capacity = MESSAGES.capacityNotInteger;
  else {
    capacity = Number(capacityRaw);
    if (capacity < 1) errors.capacity = MESSAGES.capacityTooSmall;
    else if (capacity > MAX_CAPACITY) errors.capacity = MESSAGES.capacityTooLarge;
  }

  const priceRaw = text(form, 'price').trim();
  let priceCents = 0;
  if (!priceRaw) errors.price = MESSAGES.priceRequired;
  else if (NUMERIC_PRICE.test(priceRaw) && Number(priceRaw.replace(',', '.')) <= 0) {
    errors.price = MESSAGES.priceNotPositive;
  } else {
    const cents = parsePriceToCents(priceRaw);
    if (cents === null) errors.price = MESSAGES.priceInvalid;
    else if (cents <= 0) errors.price = MESSAGES.priceNotPositive;
    else if (cents > MAX_PRICE_CENTS) errors.price = MESSAGES.priceTooLarge;
    else priceCents = cents;
  }

  if (Object.keys(errors).length > 0 || !startsAt) return { ok: false, errors };
  return { ok: true, value: { name, venue, startsAt, capacity, priceCents } };
}

/** "25/12/2026 20:00" em America/Sao_Paulo. */
export function formatEventDateTime(d: Date): string {
  const iso = toIsoWithOffset(d); // "2026-12-25T20:00:00-03:00"
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

/** "2026-12-25T20:00" (valor de <input type="datetime-local">) em America/Sao_Paulo. */
export function toDateTimeLocalValue(d: Date): string {
  return toIsoWithOffset(d).slice(0, 16);
}

/** 15000 -> "150,00" (sem separador de milhar, para voltar a ser aceito por parsePriceToCents). */
export function centsToPriceInput(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

const EVENT_STATUS_LABELS: Record<EventRow['status'], string> = {
  draft: 'rascunho',
  published: 'publicado',
  cancelled: 'cancelado',
};

/** draft -> "rascunho", published -> "publicado", cancelled -> "cancelado". */
export function eventStatusLabel(s: EventRow['status']): string {
  return EVENT_STATUS_LABELS[s];
}

/** Valores enviados no formulário (não-string -> ''), para re-renderizar após um 422. */
export function formValues(form: Record<string, unknown>): EventFormValues {
  return {
    name: text(form, 'name'),
    venue: text(form, 'venue'),
    startsAt: text(form, 'startsAt'),
    capacity: text(form, 'capacity'),
    price: text(form, 'price'),
  };
}

/** Valores do formulário de edição gerados a partir do evento gravado. */
export function eventToFormValues(e: EventRow): EventFormValues {
  return {
    name: e.name,
    venue: e.venue,
    startsAt: toDateTimeLocalValue(e.starts_at),
    capacity: String(e.capacity),
    price: centsToPriceInput(e.price_cents),
  };
}

export const EMPTY_FORM_VALUES: EventFormValues = { name: '', venue: '', startsAt: '', capacity: '', price: '' };

/** Formatadores disponíveis nas views de F04 (e nos partials, que recebem os locals completos). */
export const viewHelpers = { formatBRL, formatEventDateTime, eventStatusLabel } as const;
