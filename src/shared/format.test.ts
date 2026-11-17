import { describe, expect, it } from 'vitest';
import { formatCents, formatPoints } from './format';

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
