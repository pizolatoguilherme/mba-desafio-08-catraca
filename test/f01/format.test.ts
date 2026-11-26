import { describe, expect, it } from 'vitest';
import {
  formatBRL,
  parseLocalDateTime,
  parsePriceToCents,
  statusLabel,
  toIsoWithOffset,
} from '../../src/format.js';

describe('C-F01-15 format', () => {
  it('formatBRL usa espaço comum e vírgula decimal', () => {
    expect(formatBRL(35000)).toBe('R$ 350,00');
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(100000000)).toBe('R$ 1.000.000,00');
    for (const v of [0, 35000, 123456, 100000000]) {
      expect(formatBRL(v)).not.toContain(' ');
      expect(formatBRL(v).charCodeAt(2)).toBe(0x20);
    }
  });

  it('toIsoWithOffset devolve ISO com offset -03:00', () => {
    expect(toIsoWithOffset(new Date('2026-12-06T00:00:00Z'))).toBe('2026-12-05T21:00:00-03:00');
    expect(toIsoWithOffset(new Date('2026-07-01T15:30:45Z'))).toBe('2026-07-01T12:30:45-03:00');
  });

  it('parseLocalDateTime interpreta datetime-local em America/Sao_Paulo', () => {
    expect(parseLocalDateTime('2026-12-05T21:00')?.toISOString()).toBe('2026-12-06T00:00:00.000Z');
    expect(parseLocalDateTime('2026-12-05T21:00:30')?.toISOString()).toBe('2026-12-06T00:00:30.000Z');
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTime('2026-13-01T10:00')).toBeNull();
    expect(parseLocalDateTime('2026-12-05T24:00')).toBeNull();
    expect(parseLocalDateTime('2026-12-05')).toBeNull();
    expect(parseLocalDateTime('abc')).toBeNull();
    expect(parseLocalDateTime('')).toBeNull();
    // ida e volta com toIsoWithOffset
    const d = parseLocalDateTime('2026-12-05T21:00');
    expect(d && toIsoWithOffset(d)).toBe('2026-12-05T21:00:00-03:00');
  });

  it('parsePriceToCents aceita vírgula, ponto e inteiro', () => {
    for (const s of ['100,00', '100.00', '100', 'R$ 100,00', 'R$100,00']) {
      expect(parsePriceToCents(s)).toBe(10000);
    }
    expect(parsePriceToCents(' 150,5 ')).toBe(15050);
    expect(parsePriceToCents('0')).toBe(0);
    expect(parsePriceToCents('350,00')).toBe(35000);
    expect(parsePriceToCents('0,99')).toBe(99);
  });

  it('parsePriceToCents rejeita entradas inválidas', () => {
    for (const s of ['', 'abc', '-1', '1.234,56', '10,999', '   ', '10,', ',50', '1e3', 'R$']) {
      expect(parsePriceToCents(s)).toBeNull();
    }
  });

  it('statusLabel traduz os cinco status', () => {
    expect(statusLabel('pending')).toBe('pendente');
    expect(statusLabel('confirmed')).toBe('confirmado');
    expect(statusLabel('declined')).toBe('recusado');
    expect(statusLabel('cancelled')).toBe('cancelado');
    expect(statusLabel('refunded')).toBe('estornado');
  });
});
