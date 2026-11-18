import { describe, expect, it } from 'vitest';
import { formatCents, formatPoints, formatTime } from './format';

// Non-breaking space keeps the number and the unit on the same line.
const NBSP = ' ';

describe('formatCents', () => {
  it.each([
    [1250, `12,50${NBSP}€`],
    [0, `0,00${NBSP}€`],
    [5, `0,05${NBSP}€`],
    [100, `1,00${NBSP}€`],
    [123456, `1.234,56${NBSP}€`],
    [100000000, `1.000.000,00${NBSP}€`],
    [-500, `-5,00${NBSP}€`],
  ])('formats %i cents as %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-integer cents (%s)',
    (value) => {
      expect(() => formatCents(value)).toThrow(RangeError);
    },
  );
});

describe('formatPoints', () => {
  it.each([
    [45, `45${NBSP}pt`],
    [0, `0${NBSP}pt`],
    [1, `1${NBSP}pt`],
    [12500, `12.500${NBSP}pt`],
    [-30, `-30${NBSP}pt`],
  ])('formats %i points as %s', (points, expected) => {
    expect(formatPoints(points)).toBe(expected);
  });

  it.each([1.5, Number.NaN])('rejects non-integer points (%s)', (value) => {
    expect(() => formatPoints(value)).toThrow(RangeError);
  });
});

describe('formatTime', () => {
  it.each([
    // Winter: Rome is UTC+1.
    ['2026-11-18T09:15:00Z', '10:15'],
    ['2026-11-18T08:58:59.999Z', '09:58'],
    // Summer: Rome is UTC+2.
    ['2026-07-01T06:31:00Z', '08:31'],
    // Just after midnight in Rome, still the day before in UTC.
    ['2026-11-17T23:05:00Z', '00:05'],
    // An offset other than Z is read as the instant it names.
    ['2026-11-18T10:15:00+01:00', '10:15'],
  ])('formats %s as %s (Europe/Rome)', (iso, expected) => {
    expect(formatTime(iso)).toBe(expected);
  });

  it('rejects a text that is not a date', () => {
    expect(() => formatTime('ieri')).toThrow(RangeError);
  });
});
