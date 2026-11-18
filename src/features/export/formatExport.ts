// Cells and file names of the CSV export (SPEC-export, "Formato del file"). Unlike shared/format, these
// are for Excel, not the screen: no € sign, no thousands separator, dates assembled part by part.
// Every date is read on the bar's clock (Europe/Rome), whatever the device's time zone.

import type { ExportKind, MovementExportKind } from './types';

const TIME_ZONE = 'Europe/Rome';

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // h23, so midnight is 00 and never 24.
  hourCycle: 'h23',
  timeZone: TIME_ZONE,
});

type DatePartType = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

function partsOf(date: Date): Record<DatePartType, string> {
  const parts = dateTimeFormat.formatToParts(date);
  const part = (type: DatePartType): string => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new RangeError(`missing date part: ${type}`);
    return value;
  };
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

function parseDate(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`not a date: ${iso}`);
  }
  return date;
}

/** centsToEuroCell(1250) → "12,50", (-1250) → "-12,50", (123456) → "1234,56". */
export function centsToEuroCell(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`cents must be a safe integer, got ${cents}`);
  }
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}${euros},${rest}`;
}

/** romeDateTime("2026-07-01T10:05:00Z") → "01/07/2026 12:05:00"; no date → "". */
export function romeDateTime(iso: string | null): string {
  if (iso === null) return '';
  const { year, month, day, hour, minute, second } = partsOf(parseDate(iso));
  return `${day}/${month}/${year} ${hour}:${minute}:${second}`;
}

/** romeDateStamp(2026-11-17T23:30Z) → "2026-11-18": today's day in Rome, for the file name. */
export function romeDateStamp(date: Date): string {
  const { year, month, day } = partsOf(date);
  return `${year}-${month}-${day}`;
}

const FILE_PREFIX: Record<ExportKind, string> = {
  customers: 'enjoy-clienti',
  movements: 'enjoy-movimenti',
};

/** exportFileName('movements', now) → "enjoy-movimenti-2026-11-18.csv", with the day in Rome. */
export function exportFileName(kind: ExportKind, now: Date): string {
  return `${FILE_PREFIX[kind]}-${romeDateStamp(now)}.csv`;
}

const KIND_LABEL: Record<MovementExportKind, string> = {
  purchase: 'Spesa',
  redemption: 'Riscatto',
  correction: 'Correzione',
};

/** The "Tipo" column: Spesa | Riscatto | Correzione. */
export function kindLabel(kind: MovementExportKind): string {
  return KIND_LABEL[kind];
}
