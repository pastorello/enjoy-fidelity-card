import type { LinkState } from './types';

// SPEC-cards, "Modello dati": the state of the link to the points is computed from two non-secret
// instants of app.cards. Postgres keeps microseconds, more than a JavaScript Date: issue and confirm
// can fall in the same millisecond, so the instants are compared in microseconds.

const INSTANT =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** Microseconds since the epoch, or null when the text is not a Postgres/ISO instant. */
function micros(instant: string): number | null {
  const match = INSTANT.exec(instant);
  if (!match) return null;
  const [, date = '', time = '', fraction = '', zone = ''] = match;
  const offset = zone.toUpperCase() === 'Z' ? 'Z' : normalizeOffset(zone);
  const seconds = Date.parse(`${date}T${time}${offset}`);
  if (Number.isNaN(seconds)) return null;
  return seconds * 1000 + Number(fraction.padEnd(6, '0').slice(0, 6));
}

/** `+01`, `+0100` or `+01:00` as `+01:00`. */
function normalizeOffset(zone: string): string {
  const digits = zone.slice(1).replace(':', '').padEnd(4, '0');
  return `${zone.slice(0, 1)}${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

/**
 * `not-written` while no link was ever confirmed, `unverified` when a newer link was issued after the
 * written one and not confirmed (the card may hold either), `written` otherwise.
 */
export function linkStateOf(writtenAt: string | null, pendingAt: string | null): LinkState {
  if (writtenAt === null) return 'not-written';
  if (pendingAt === null) return 'written';
  const written = micros(writtenAt);
  const pending = micros(pendingAt);
  // An instant that cannot be read: the conservative answer is that the card may not hold the link.
  if (written === null || pending === null) return 'unverified';
  return pending > written ? 'unverified' : 'written';
}
