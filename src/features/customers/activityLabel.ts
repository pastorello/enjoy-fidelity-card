// SPEC-customers-v2 point 6: the last activity under a name of the home list, on the bar's clock
// (Europe/Rome) whatever the device's time zone.

import { formatTime } from '../../shared/format';

const TIME_ZONE = 'Europe/Rome';

/** "2026-11-08": the calendar day in Rome, comparable as a string. */
const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: TIME_ZONE,
});

const dayMonth = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  timeZone: TIME_ZONE,
});

const dayMonthYear = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: TIME_ZONE,
});

function parseDate(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new RangeError(`not a date: ${iso}`);
  return date;
}

/** The day before `key`, by the calendar: right also on the 23- and 25-hour days. */
function previousDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const previous = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - 1));
  return previous.toISOString().slice(0, 10);
}

/**
 * "Oggi, 10:15", "Ieri, 18:40", "12 nov" (this year), "12 nov 2025" (another year), or "Nessun
 * movimento" without purchases or redemptions; the day relative to `now`.
 */
export function activityLabel(lastActivityAt: string | null, now: Date = new Date()): string {
  if (lastActivityAt === null) return 'Nessun movimento';
  const date = parseDate(lastActivityAt);
  const key = dayKeyFormat.format(date);
  const today = dayKeyFormat.format(now);
  if (key === today) return `Oggi, ${formatTime(lastActivityAt)}`;
  if (key === previousDayKey(today)) return `Ieri, ${formatTime(lastActivityAt)}`;
  return (key.slice(0, 4) === today.slice(0, 4) ? dayMonth : dayMonthYear).format(date);
}
