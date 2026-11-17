import { describe, expect, it } from 'vitest';
import {
  CENTS_PER_POINT_LIMIT,
  CONFIRM_THRESHOLD_LIMIT,
  centsToEuroInput,
  parseEuroInput,
} from './parseEuroInput';

const EMPTY = 'Inserisci un importo, per esempio 1,00.';
const INVALID = 'Scrivi solo cifre e la virgola, per esempio 1,50.';
const TOO_MANY_DECIMALS = 'Usa al massimo due decimali, per esempio 1,50.';
const ZERO = 'Deve essere maggiore di 0,00 €.';

describe('parseEuroInput', () => {
  it.each([
    ['1', 100],
    ['1,5', 150],
    ['1,50', 150],
    ['1.50', 150],
    [' 2 ', 200],
    ['0,05', 5],
    ['12,34', 1234],
  ])('parses %j as %i cents', (text, cents) => {
    expect(parseEuroInput(text, CENTS_PER_POINT_LIMIT)).toEqual({ ok: true, cents });
  });

  it.each([
    ['', EMPTY],
    ['   ', EMPTY],
    ['abc', INVALID],
    ['-1', INVALID],
    ['1,2,3', INVALID],
    ['1 000', INVALID],
    ['1,', INVALID],
    [',5', INVALID],
    ['1e2', INVALID],
    ['1,555', TOO_MANY_DECIMALS],
    ['1.250', TOO_MANY_DECIMALS],
    ['0', ZERO],
    ['0,00', ZERO],
  ])('rejects %j with %j', (text, error) => {
    expect(parseEuroInput(text, CENTS_PER_POINT_LIMIT)).toEqual({ ok: false, error });
  });

  it('accepts the points ratio up to 100,00 € and rejects above it', () => {
    expect(parseEuroInput('100,00', CENTS_PER_POINT_LIMIT)).toEqual({ ok: true, cents: 10000 });
    expect(parseEuroInput('100,01', CENTS_PER_POINT_LIMIT)).toEqual({
      ok: false,
      error: 'Al massimo 100,00 € per punto.',
    });
  });

  it('accepts the confirmation threshold up to 10.000,00 € and rejects above it', () => {
    expect(parseEuroInput('10000,00', CONFIRM_THRESHOLD_LIMIT)).toEqual({
      ok: true,
      cents: 1000000,
    });
    expect(parseEuroInput('10000,01', CONFIRM_THRESHOLD_LIMIT)).toEqual({
      ok: false,
      error: 'Al massimo 10.000,00 €.',
    });
  });

  it('rejects huge numbers as above the maximum without losing precision', () => {
    expect(parseEuroInput('99999999999999999999', CONFIRM_THRESHOLD_LIMIT)).toEqual({
      ok: false,
      error: 'Al massimo 10.000,00 €.',
    });
  });

  it('matches the database limits', () => {
    expect(CENTS_PER_POINT_LIMIT.max).toBe(10000);
    expect(CONFIRM_THRESHOLD_LIMIT.max).toBe(1000000);
  });
});

describe('centsToEuroInput', () => {
  it.each([
    [100, '1,00'],
    [15000, '150,00'],
    [5, '0,05'],
    [1000000, '10000,00'],
  ])('formats %i cents as %j', (cents, text) => {
    expect(centsToEuroInput(cents)).toBe(text);
  });

  it('round-trips through parseEuroInput', () => {
    expect(parseEuroInput(centsToEuroInput(1234), CENTS_PER_POINT_LIMIT)).toEqual({
      ok: true,
      cents: 1234,
    });
  });

  it.each([12.5, -1, Number.NaN])('rejects invalid cents (%s)', (value) => {
    expect(() => centsToEuroInput(value)).toThrow(RangeError);
  });
});
