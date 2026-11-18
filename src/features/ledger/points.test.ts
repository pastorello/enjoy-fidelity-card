import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  MAX_AMOUNT_CENTS,
  MAX_FREE_REWARD_POINTS,
  amountKeypadReducer,
  formatConfirmAmount,
  freePointsKeypadReducer,
  isUnusualAmount,
  pointsFor,
  type AmountKey,
  type PointsKey,
} from './points';

function typeAmount(keys: AmountKey[], start = 0): number {
  return keys.reduce(amountKeypadReducer, start);
}

function typePoints(keys: PointsKey[], start = 0): number {
  return keys.reduce(freePointsKeypadReducer, start);
}

describe('pointsFor', () => {
  it('rounds down with the ratio in force', () => {
    expect(pointsFor(1250, 100)).toBe(12);
    expect(pointsFor(1250, 250)).toBe(5);
    expect(pointsFor(199, 100)).toBe(1);
    expect(pointsFor(99, 100)).toBe(0);
    expect(pointsFor(0, 100)).toBe(0);
    expect(pointsFor(MAX_AMOUNT_CENTS, 1)).toBe(9_999_999);
  });

  it('refuses amounts and ratios that break the domain rules', () => {
    expect(() => pointsFor(12.5, 100)).toThrow(RangeError);
    expect(() => pointsFor(-1, 100)).toThrow(RangeError);
    expect(() => pointsFor(1250, 0)).toThrow(RangeError);
    expect(() => pointsFor(1250, 2.5)).toThrow(RangeError);
  });
});

describe('amountKeypadReducer', () => {
  it('enters cents from the right as on a POS: 1-2-5-0 = 12,50 €', () => {
    expect(typeAmount(['1', '2', '5', '0'])).toBe(1250);
    expect(pointsFor(typeAmount(['1', '2', '5', '0']), 100)).toBe(12);
    expect(pointsFor(typeAmount(['1', '2', '5', '0']), 250)).toBe(5);
  });

  it('adds two zeros with "00"', () => {
    expect(typeAmount(['1', '2', '00'])).toBe(1200);
  });

  it('ignores leading zeros: 0 then 5 = 0,05 €', () => {
    expect(typeAmount(['0', '5'])).toBe(5);
    expect(typeAmount(['00', '0', '7'])).toBe(7);
  });

  it('removes the last digit with backspace and stays at 0 on 0', () => {
    expect(typeAmount(['1', '2', '5', 'backspace'])).toBe(12);
    expect(typeAmount(['backspace'])).toBe(0);
    expect(typeAmount(['5', 'backspace', 'backspace'])).toBe(0);
  });

  it('ignores the digits beyond 9.999.999 cents (99.999,99 €)', () => {
    const max = typeAmount(['9', '9', '9', '9', '9', '9', '9']);
    expect(max).toBe(MAX_AMOUNT_CENTS);
    expect(amountKeypadReducer(max, '1')).toBe(MAX_AMOUNT_CENTS);
    expect(amountKeypadReducer(max, '0')).toBe(MAX_AMOUNT_CENTS);
    expect(amountKeypadReducer(max, 'backspace')).toBe(999_999);
  });

  it('ignores the whole "00" when the second zero would not fit', () => {
    // 6 digits + "00" = 8 digits: neither zero enters, so the amount is never off by one digit.
    expect(amountKeypadReducer(123_456, '00')).toBe(123_456);
    expect(amountKeypadReducer(12_345, '00')).toBe(1_234_500);
  });
});

describe('freePointsKeypadReducer', () => {
  it('enters points from the right, 1..99999', () => {
    expect(typePoints(['1', '0', '0'])).toBe(100);
    expect(typePoints(['0', '5'])).toBe(5);
    expect(typePoints(['9', '9', '9', '9', '9'])).toBe(MAX_FREE_REWARD_POINTS);
  });

  it('ignores digits beyond 5 and removes the last one with backspace', () => {
    expect(freePointsKeypadReducer(MAX_FREE_REWARD_POINTS, '9')).toBe(MAX_FREE_REWARD_POINTS);
    expect(freePointsKeypadReducer(12_345, '0')).toBe(12_345);
    expect(typePoints(['1', '2', 'backspace'])).toBe(1);
    expect(typePoints(['backspace'])).toBe(0);
  });

  it('has no "00" key', () => {
    expectTypeOf<'00'>().not.toExtend<PointsKey>();
    expect(typePoints(['1', '0', '0', '0', '0', '0'])).toBe(10_000);
  });
});

describe('isUnusualAmount', () => {
  it('is strictly above the threshold', () => {
    expect(isUnusualAmount(15_000, 15_000)).toBe(false);
    expect(isUnusualAmount(15_001, 15_000)).toBe(true);
    expect(isUnusualAmount(14_999, 15_000)).toBe(false);
  });
});

describe('formatConfirmAmount', () => {
  it('omits ",00" for whole euros and keeps the cents otherwise', () => {
    expect(`Conferma ${formatConfirmAmount(125_000)}`).toBe('Conferma 1.250 €');
    expect(`Conferma ${formatConfirmAmount(15_001)}`).toBe('Conferma 150,01 €');
    expect(formatConfirmAmount(500)).toBe('5 €');
    expect(formatConfirmAmount(5)).toBe('0,05 €');
  });
});
