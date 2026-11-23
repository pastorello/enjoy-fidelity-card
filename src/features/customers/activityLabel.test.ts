import { describe, expect, it } from 'vitest';
import { activityLabel } from './activityLabel';

// Every expectation is on the bar's clock (Europe/Rome); the CI runs in UTC, so the instants
// below sit where the UTC day and the Rome day differ. Timestamps as PostgREST sends them,
// microseconds included.

describe('activityLabel', () => {
  const now = new Date('2026-11-23T15:00:00Z'); // 16:00 in Rome

  it('reads an activity of today as "Oggi, HH:MM"', () => {
    expect(activityLabel('2026-11-23T09:15:00.123456+00:00', now)).toBe('Oggi, 10:15');
  });

  it('reads an activity of yesterday as "Ieri, HH:MM"', () => {
    expect(activityLabel('2026-11-22T17:40:59.999999+00:00', now)).toBe('Ieri, 18:40');
  });

  it('reads an older activity of this year as day and month', () => {
    expect(activityLabel('2026-11-12T10:00:00+00:00', now)).toBe('12 nov');
  });

  it('adds the year for another year', () => {
    expect(activityLabel('2025-11-12T10:00:00+00:00', now)).toBe('12 nov 2025');
  });

  it('reads no activity as "Nessun movimento"', () => {
    expect(activityLabel(null, now)).toBe('Nessun movimento');
  });

  it('uses the Rome day, not the UTC one, around midnight', () => {
    // 00:30 of 24 November in Rome, still 23 November in UTC.
    const justAfterMidnight = new Date('2026-11-23T23:30:00Z');
    expect(activityLabel('2026-11-23T23:10:00+00:00', justAfterMidnight)).toBe('Oggi, 00:10');
    expect(activityLabel('2026-11-23T22:45:00+00:00', justAfterMidnight)).toBe('Ieri, 23:45');
    // 31 December 23:30 UTC is already the new year in Rome.
    const newYear = new Date('2027-01-01T10:00:00Z');
    expect(activityLabel('2026-12-31T23:30:00+00:00', newYear)).toBe('Oggi, 00:30');
    expect(activityLabel('2026-12-31T22:30:00+00:00', newYear)).toBe('Ieri, 23:30');
    expect(activityLabel('2026-12-30T12:00:00+00:00', newYear)).toBe('30 dic 2026');
  });

  it('follows the change to summer time (the 23-hour day)', () => {
    // 29 March 2026: 02:00 CET becomes 03:00 CEST.
    const afternoon = new Date('2026-03-29T14:00:00Z');
    expect(activityLabel('2026-03-29T00:30:00+00:00', afternoon)).toBe('Oggi, 01:30');
    expect(activityLabel('2026-03-29T01:30:00+00:00', afternoon)).toBe('Oggi, 03:30');
    expect(activityLabel('2026-03-28T22:59:00+00:00', afternoon)).toBe('Ieri, 23:59');
    // The day after the 23-hour day: yesterday is still the 29th.
    const nextDay = new Date('2026-03-30T08:00:00Z');
    expect(activityLabel('2026-03-28T23:30:00+00:00', nextDay)).toBe('Ieri, 00:30');
    expect(activityLabel('2026-03-28T22:30:00+00:00', nextDay)).toBe('28 mar');
  });

  it('follows the change to winter time (the 25-hour day)', () => {
    // 25 October 2026: 03:00 CEST becomes 02:00 CET.
    const lateEvening = new Date('2026-10-25T22:30:00Z'); // 23:30 CET
    expect(activityLabel('2026-10-24T22:30:00+00:00', lateEvening)).toBe('Oggi, 00:30');
    expect(activityLabel('2026-10-24T21:59:00+00:00', lateEvening)).toBe('Ieri, 23:59');
    const nextDay = new Date('2026-10-26T00:30:00Z'); // 01:30 CET of the 26th
    expect(activityLabel('2026-10-25T22:59:00+00:00', nextDay)).toBe('Ieri, 23:59');
    expect(activityLabel('2026-10-24T21:59:00+00:00', nextDay)).toBe('24 ott');
  });

  it('rejects a value that is not a date', () => {
    expect(() => activityLabel('ieri', now)).toThrow(RangeError);
  });
});
