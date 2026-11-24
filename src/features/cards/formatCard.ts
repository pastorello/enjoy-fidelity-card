// SPEC-cards, "Etichetta della card": how a card and its holder are named in the screens.

const TIME_ZONE = 'Europe/Rome';

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

const yearOnly = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: TIME_ZONE });

/** formatCardLabel('04A1B2C3D4E5F6') → "…E5F6": an ellipsis and the last four characters of the uid. */
export function formatCardLabel(uid: string): string {
  return `…${uid.slice(-4)}`;
}

/** shortName('Maria Rossi') → "Maria": the first word of the name, for «a Maria», «di Antonio». */
export function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/**
 * formatCardDay('2026-11-12T09:00:00Z') → "12 nov": a day of the card's life, in Europe/Rome, with
 * the year only when it is not the current one («Disattivata il 12 nov»).
 */
export function formatCardDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`not a date: ${iso}`);
  }
  const sameYear = yearOnly.format(date) === yearOnly.format(now);
  return (sameYear ? dayMonth : dayMonthYear).format(date);
}

/**
 * formatCardSince('2026-11-03T09:00:00Z') → "dal 3 nov": the day the card was associated or
 * reactivated, in Europe/Rome, with the year only when it is not the current one.
 */
export function formatCardSince(iso: string, now: Date = new Date()): string {
  return `dal ${formatCardDay(iso, now)}`;
}
