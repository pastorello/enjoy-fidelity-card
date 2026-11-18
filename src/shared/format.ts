// Display formatting for amounts and points (it-IT). Values are integers by
// domain rule: amounts in cents, points as whole numbers.

const NBSP = ' ';

const integerFormat = new Intl.NumberFormat('it-IT', {
  maximumFractionDigits: 0,
  // Italian locale data skips grouping for 4-digit numbers; the app always groups.
  useGrouping: 'always',
});

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${value}`);
  }
}

function signOf(value: number): string {
  return value < 0 ? '-' : '';
}

/** formatCents(1250) → "12,50 €" (with a non-breaking space). */
export function formatCents(amountCents: number): string {
  assertInteger(amountCents, 'amountCents');
  const abs = Math.abs(amountCents);
  const euros = Math.trunc(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${signOf(amountCents)}${integerFormat.format(euros)},${cents}${NBSP}€`;
}

/** formatInteger(1250) → "1.250": always grouped, as the other figures of the app. */
export function formatInteger(value: number): string {
  assertInteger(value, 'value');
  return `${signOf(value)}${integerFormat.format(Math.abs(value))}`;
}

/** formatPoints(45) → "45 pt" (with a non-breaking space). */
export function formatPoints(points: number): string {
  assertInteger(points, 'points');
  return `${formatInteger(points)}${NBSP}pt`;
}

const timeFormat = new Intl.DateTimeFormat('it-IT', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  // The bar's clock, whatever the device's time zone.
  timeZone: 'Europe/Rome',
});

const dateFormat = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Rome',
});

function parseDate(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`not a date: ${iso}`);
  }
  return date;
}

/** formatTime('2026-11-18T09:15:00Z') → "10:15": hours and minutes in Europe/Rome. */
export function formatTime(iso: string): string {
  return timeFormat.format(parseDate(iso));
}

/** formatDate('2026-11-17T12:00:00Z') → "17 nov 2026": the day in Europe/Rome. */
export function formatDate(iso: string): string {
  return dateFormat.format(parseDate(iso));
}
