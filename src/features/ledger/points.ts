// Pure arithmetic of the cash desk: points of a purchase, the two numeric keypads and the
// confirmation of an unusual amount. Amounts are integer cents, points whole numbers.

import { formatCents, formatInteger } from '../../shared/format';

/** 99.999,99 €: the largest purchase the server accepts (SPEC-ledger, Open Question 5). */
export const MAX_AMOUNT_CENTS = 9_999_999;

/** The largest free reward, as the catalog rewards (SPEC-ledger, Open Question 5). */
export const MAX_FREE_REWARD_POINTS = 99_999;

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** A key of the amount keypad: a digit, "Doppio zero" or "Cancella ultima cifra". */
export type AmountKey = Digit | '00' | 'backspace';

/** A key of the free reward keypad: no "00" there (an empty cell in the wireframe). */
export type PointsKey = Digit | 'backspace';

const DIGITS = new Set<string>(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${value}`);
  }
}

/**
 * Points earned by a purchase, rounded down: pointsFor(1250, 100) → 12. Only a preview: the
 * server computes the points it records with the ratio in force at that moment.
 */
export function pointsFor(amountCents: number, centsPerPoint: number): number {
  assertNonNegativeInteger(amountCents, 'amountCents');
  if (!Number.isSafeInteger(centsPerPoint) || centsPerPoint <= 0) {
    throw new RangeError(`centsPerPoint must be a positive safe integer, got ${centsPerPoint}`);
  }
  return Math.floor(amountCents / centsPerPoint);
}

/** Appends `digits` on the right, or ignores them all if the result would pass `max`. */
function append(value: number, digits: string, max: number): number {
  const next = value * 10 ** digits.length + Number(digits);
  return next > max ? value : next;
}

function removeLast(value: number): number {
  return Math.floor(value / 10);
}

/**
 * The amount keypad, as on a POS: every digit enters on the right (1-2-5-0 = 1250 cents), "00"
 * adds two zeros, backspace removes the last digit, leading zeros vanish (0 then 5 = 5 cents).
 * A key that would pass 9.999.999 cents is ignored whole, so "00" never adds a single zero.
 */
export function amountKeypadReducer(amountCents: number, key: AmountKey): number {
  if (key === 'backspace') return removeLast(amountCents);
  if (key === '00' || DIGITS.has(key)) return append(amountCents, key, MAX_AMOUNT_CENTS);
  return amountCents;
}

/**
 * The points keypad of the free reward: same rules as the amount keypad, at most 99.999, and no
 * "00" key (anything that is not a digit or backspace changes nothing).
 */
export function freePointsKeypadReducer(points: number, key: PointsKey): number {
  if (key === 'backspace') return removeLast(points);
  if (DIGITS.has(key)) return append(points, key, MAX_FREE_REWARD_POINTS);
  return points;
}

/** A purchase asks for confirmation only when strictly above the threshold (SPEC-settings). */
export function isUnusualAmount(amountCents: number, confirmThresholdCents: number): boolean {
  return amountCents > confirmThresholdCents;
}

/**
 * The amount on the "Conferma …" button of "Importo insolito": "1.250 €" for whole euros (as in
 * the wireframe), "150,01 €" otherwise; non-breaking space before € as `formatCents`.
 */
export function formatConfirmAmount(amountCents: number): string {
  assertNonNegativeInteger(amountCents, 'amountCents');
  if (amountCents % 100 === 0) return `${formatInteger(amountCents / 100)} €`;
  return formatCents(amountCents);
}
