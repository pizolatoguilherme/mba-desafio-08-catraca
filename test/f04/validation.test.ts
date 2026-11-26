import { describe, expect, it } from 'vitest';
import {
  centsToPriceInput,
  formatEventDateTime,
  toDateTimeLocalValue,
  validateEventInput,
} from '../../src/events/validation.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const VALID = { name: 'Jazz no Porão', venue: 'Bar do Porão', startsAt: '2026-12-05T21:00', capacity: '3', price: '100,00' };

function errorsOf(form: Record<string, unknown>): Record<string, string> {
  const r = validateEventInput(form, NOW);
  if (r.ok) throw new Error('esperava erro de validação');
  return r.errors;
}

describe('F04 validação', () => {
  it('C-F04-20 validateEventInput aceita entrada válida e converte os valores', () => {
    const r = validateEventInput({ ...VALID, name: '  Jazz no Porão  ', venue: ' Bar do Porão ' }, NOW);
    expect(r).toEqual({
      ok: true,
      value: {
        name: 'Jazz no Porão',
        venue: 'Bar do Porão',
        startsAt: new Date('2026-12-06T00:00:00.000Z'),
        capacity: 3,
        priceCents: 10000,
      },
    });
    if (!r.ok) return;
    expect(r.value.startsAt.toISOString()).toBe('2026-12-06T00:00:00.000Z');
    expect(typeof r.value.name).toBe('string');

    const dot = validateEventInput({ ...VALID, price: '100.00' }, NOW);
    expect(dot.ok && dot.value.priceCents).toBe(10000);
    const plain = validateEventInput({ ...VALID, price: '150,5' }, NOW);
    expect(plain.ok && plain.value.priceCents).toBe(15050);
    const limits = validateEventInput({ ...VALID, capacity: '100000', price: '100000,00', name: 'n'.repeat(200) }, NOW);
    expect(limits.ok).toBe(true);
  });

  it('C-F04-20 validateEventInput rejeita cada campo com a mensagem definida', () => {
    const cases: Array<[string, unknown, string]> = [
      ['name', undefined, 'Informe o nome do evento.'],
      ['name', '', 'Informe o nome do evento.'],
      ['name', '   ', 'Informe o nome do evento.'],
      ['name', ['A', 'B'], 'Informe o nome do evento.'],
      ['name', 'n'.repeat(201), 'O nome deve ter no máximo 200 caracteres.'],
      ['venue', undefined, 'Informe o local do evento.'],
      ['venue', '  ', 'Informe o local do evento.'],
      ['venue', ['X', 'Y'], 'Informe o local do evento.'],
      ['venue', 'v'.repeat(201), 'O local deve ter no máximo 200 caracteres.'],
      ['startsAt', undefined, 'Informe a data e hora de início.'],
      ['startsAt', '', 'Informe a data e hora de início.'],
      ['startsAt', ['2026-12-05T21:00', '2026-12-06T21:00'], 'Informe a data e hora de início.'],
      ['startsAt', 'amanhã', 'Data e hora de início inválidas.'],
      ['startsAt', '2026-02-30T20:00', 'Data e hora de início inválidas.'],
      ['capacity', undefined, 'Informe a lotação.'],
      ['capacity', '', 'Informe a lotação.'],
      ['capacity', ['2', '3'], 'Informe a lotação.'],
      ['capacity', '2.5', 'A lotação deve ser um número inteiro.'],
      ['capacity', 'abc', 'A lotação deve ser um número inteiro.'],
      ['capacity', '0', 'A lotação deve ser de pelo menos 1.'],
      ['capacity', '-1', 'A lotação deve ser de pelo menos 1.'],
      ['capacity', '100001', 'A lotação deve ser de no máximo 100000.'],
      ['price', undefined, 'Informe o preço.'],
      ['price', '', 'Informe o preço.'],
      ['price', ['10,00', '20,00'], 'Informe o preço.'],
      ['price', '0', 'O preço deve ser maior que zero.'],
      ['price', '0,00', 'O preço deve ser maior que zero.'],
      ['price', '-5', 'O preço deve ser maior que zero.'],
      ['price', 'abc', 'Preço inválido. Use o formato 100,00.'],
      ['price', '10,999', 'Preço inválido. Use o formato 100,00.'],
      ['price', '100000,01', 'O preço deve ser de no máximo R$ 100.000,00.'],
    ];
    for (const [key, value, message] of cases) {
      const form: Record<string, unknown> = { ...VALID };
      if (value === undefined) delete form[key];
      else form[key] = value;
      const errors = errorsOf(form);
      expect(errors, `${key}=${JSON.stringify(value)}`).toEqual({ [key]: message });
    }
    // Todos os campos ausentes de uma vez: uma mensagem por campo.
    expect(errorsOf({})).toEqual({
      name: 'Informe o nome do evento.',
      venue: 'Informe o local do evento.',
      startsAt: 'Informe a data e hora de início.',
      capacity: 'Informe a lotação.',
      price: 'Informe o preço.',
    });
  });

  it('C-F04-20 validateEventInput rejeita data de início no passado', () => {
    const msg = 'A data de início precisa estar no futuro.';
    // NOW = 2026-11-26T12:00Z = 09:00 em America/Sao_Paulo.
    expect(errorsOf({ ...VALID, startsAt: '2026-11-26T09:00' })).toEqual({ startsAt: msg }); // igual a now
    expect(errorsOf({ ...VALID, startsAt: '2026-11-26T08:59' })).toEqual({ startsAt: msg });
    expect(errorsOf({ ...VALID, startsAt: '2025-01-01T20:00' })).toEqual({ startsAt: msg });
    expect(validateEventInput({ ...VALID, startsAt: '2026-11-26T09:01' }, NOW).ok).toBe(true);
  });

  it('C-F04-20 formatadores de data e preço usam America/Sao_Paulo', () => {
    const d = new Date('2026-12-06T00:00:00Z');
    expect(formatEventDateTime(d)).toBe('05/12/2026 21:00');
    expect(toDateTimeLocalValue(d)).toBe('2026-12-05T21:00');
    expect(formatEventDateTime(new Date('2026-12-25T23:00:00Z'))).toBe('25/12/2026 20:00');
    expect(centsToPriceInput(15000)).toBe('150,00');
    expect(centsToPriceInput(10050)).toBe('100,50');
    expect(centsToPriceInput(123456)).toBe('1234,56');
    expect(centsToPriceInput(5)).toBe('0,05');
  });
});
