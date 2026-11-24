import { formatCardDay, formatCardLabel, formatCardSince, shortName } from './formatCard';

describe('formatCardLabel', () => {
  it('shows an ellipsis and the last four characters of the uid', () => {
    expect(formatCardLabel('04A1B2C3D4E5F6')).toBe('…E5F6');
  });

  it('keeps a short uid whole', () => {
    expect(formatCardLabel('A1B')).toBe('…A1B');
  });
});

describe('shortName', () => {
  it('is the first word of the name, as in the wireframes', () => {
    expect(shortName('Maria Rossi')).toBe('Maria');
    expect(shortName('Antonio')).toBe('Antonio');
  });

  it('ignores surrounding and repeated spaces', () => {
    expect(shortName('  Anna   Maria Bianchi ')).toBe('Anna');
  });
});

describe('formatCardSince', () => {
  const now = new Date('2026-11-18T10:00:00Z');

  it('omits the year when it is the current one', () => {
    expect(formatCardSince('2026-11-03T09:00:00Z', now)).toBe('dal 3 nov');
  });

  it('adds the year when it differs from the current one', () => {
    expect(formatCardSince('2025-09-14T09:00:00Z', now)).toBe('dal 14 set 2025');
  });

  it('reads the day and the year in Europe/Rome', () => {
    // 23:30 UTC on 31 December is already 1 January in Rome.
    const newYear = new Date('2027-01-01T08:00:00Z');
    expect(formatCardSince('2026-12-31T23:30:00Z', newYear)).toBe('dal 1 gen');
    // 23:30 UTC on 2 November is 3 November in Rome.
    expect(formatCardSince('2026-11-02T23:30:00Z', now)).toBe('dal 3 nov');
  });

  it('compares the year in Europe/Rome too', () => {
    // At 23:30 UTC on 31 December it is already the new year in Rome.
    const romeNewYear = new Date('2026-12-31T23:30:00Z');
    expect(formatCardSince('2026-11-03T09:00:00Z', romeNewYear)).toBe('dal 3 nov 2026');
  });

  it('rejects a text that is not a date', () => {
    expect(() => formatCardSince('ieri', now)).toThrow(RangeError);
  });
});

describe('formatCardDay', () => {
  const now = new Date('2026-11-18T10:00:00Z');

  it('is the day and the short month in Europe/Rome, the year only when not the current one', () => {
    expect(formatCardDay('2026-11-12T09:00:00Z', now)).toBe('12 nov');
    expect(formatCardDay('2025-09-14T09:00:00Z', now)).toBe('14 set 2025');
    // 23:30 UTC on 11 November is 12 November in Rome.
    expect(formatCardDay('2026-11-11T23:30:00Z', now)).toBe('12 nov');
  });

  it('rejects a value that is not a date', () => {
    expect(() => formatCardDay('ieri', now)).toThrow(RangeError);
  });
});
