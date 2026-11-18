// SPEC-ledger, points 8 and 9: how a movement reads in the customer's page and in Movimenti.
// Every date is read on the bar's clock (Europe/Rome), whatever the device's time zone.

import { formatCents, formatInteger, formatTime } from '../../shared/format';
import type { Movement } from './types';

const TIME_ZONE = 'Europe/Rome';
const MINUS = '−';

/** "2026-11-08": the calendar day in Rome, sortable and comparable as a string. */
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIME_ZONE,
});

const dayMonthShort = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  timeZone: TIME_ZONE,
});

const dayMonthYearShort = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: TIME_ZONE,
});

const dayMonthLong = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'long',
  timeZone: TIME_ZONE,
});

const dayMonthYearLong = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
});

function parseDate(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`not a date: ${iso}`);
  }
  return date;
}

function dayKey(date: Date): string {
  return dayKeyFormat.format(date);
}

function yearOf(key: string): string {
  return key.slice(0, 4);
}

/** The day before `key`, by the calendar: right also on the 23- and 25-hour days. */
function previousDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const previous = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - 1));
  return previous.toISOString().slice(0, 10);
}

/** "Spesa 15,00 €" / "Premio: Caffè" / "Correzione". */
export function movementLabel(movement: Movement): string {
  if (movement.kind === 'purchase') {
    return movement.amountCents === null ? 'Spesa' : `Spesa ${formatCents(movement.amountCents)}`;
  }
  if (movement.kind === 'redemption') {
    return movement.description === null ? 'Premio' : `Premio: ${movement.description}`;
  }
  return 'Correzione';
}

/** formatSignedPoints(15) → "+15", formatSignedPoints(-50) → "−50" (typographic minus, U+2212). */
export function formatSignedPoints(points: number): string {
  const magnitude = formatInteger(Math.abs(points));
  if (points > 0) return `+${magnitude}`;
  if (points < 0) return `${MINUS}${magnitude}`;
  return magnitude;
}

/**
 * "Oggi 10:42", "Ieri 19:10", "8 nov 18:05", "8 nov 2025 18:05": the day relative to `now`,
 * the year only when it is not the current one.
 */
export function formatMovementDate(iso: string, now: Date = new Date()): string {
  const date = parseDate(iso);
  const time = formatTime(iso);
  const key = dayKey(date);
  const today = dayKey(now);
  if (key === today) return `Oggi ${time}`;
  if (key === previousDayKey(today)) return `Ieri ${time}`;
  const day = (yearOf(key) === yearOf(today) ? dayMonthShort : dayMonthYearShort).format(date);
  return `${day} ${time}`;
}

/** A day of Movimenti: its title (OGGI, IERI, "8 NOVEMBRE", "8 NOVEMBRE 2025") and its movements. */
export type MovementDay = { key: string; title: string; movements: Movement[] };

function dayTitle(date: Date, key: string, today: string): string {
  if (key === today) return 'OGGI';
  if (key === previousDayKey(today)) return 'IERI';
  const format = yearOf(key) === yearOf(today) ? dayMonthLong : dayMonthYearLong;
  return format.format(date).toLocaleUpperCase('it-IT');
}

/**
 * Groups movements by their day in Rome, keeping their order (newest first from the service):
 * consecutive movements of the same day share a group.
 */
export function groupByDay(movements: readonly Movement[], now: Date = new Date()): MovementDay[] {
  const today = dayKey(now);
  const groups: MovementDay[] = [];
  for (const movement of movements) {
    const date = parseDate(movement.createdAt);
    const key = dayKey(date);
    const last = groups.at(-1);
    if (last?.key === key) {
      last.movements.push(movement);
    } else {
      groups.push({ key, title: dayTitle(date, key, today), movements: [movement] });
    }
  }
  return groups;
}

/**
 * The text of a correction in Movimenti: "annulla la spesa delle 18:05", "annulla il riscatto
 * delle 10:45", or "annulla la spesa del 7 nov alle 18:05" when the cancelled movement is of
 * another day than the correction (with the year when it is of another year). Null for any other
 * movement, or a correction whose cancelled movement is not known.
 */
export function correctionText(movement: Movement): string | null {
  if (
    movement.kind !== 'correction' ||
    movement.correctedKind === null ||
    movement.correctedCreatedAt === null
  ) {
    return null;
  }
  const what = movement.correctedKind === 'purchase' ? 'la spesa' : 'il riscatto';
  const corrected = parseDate(movement.correctedCreatedAt);
  const time = formatTime(movement.correctedCreatedAt);
  const correctedKey = dayKey(corrected);
  const correctionKey = dayKey(parseDate(movement.createdAt));
  if (correctedKey === correctionKey) return `annulla ${what} delle ${time}`;
  const format = yearOf(correctedKey) === yearOf(correctionKey) ? dayMonthShort : dayMonthYearShort;
  return `annulla ${what} del ${format.format(corrected)} alle ${time}`;
}
