import {
  centsToEuroCell,
  exportFileName,
  kindLabel,
  romeDateStamp,
  romeDateTime,
} from './formatExport';

describe('centsToEuroCell', () => {
  it.each([
    [0, '0,00'],
    [5, '0,05'],
    [1250, '12,50'],
    [-1250, '-12,50'],
    [123456, '1234,56'],
    [100, '1,00'],
  ])('%i cents → %s, with no € sign and no thousands separator', (cents, cell) => {
    expect(centsToEuroCell(cents)).toBe(cell);
  });

  it('rejects an amount that is not a whole number of cents', () => {
    expect(() => centsToEuroCell(1.5)).toThrow(RangeError);
    expect(() => centsToEuroCell(Number.NaN)).toThrow(RangeError);
  });
});

describe('romeDateTime', () => {
  it('reads summer time in Rome (UTC+2)', () => {
    expect(romeDateTime('2026-07-01T10:05:00Z')).toBe('01/07/2026 12:05:00');
  });

  it('reads winter time in Rome (UTC+1)', () => {
    expect(romeDateTime('2026-01-15T10:05:00Z')).toBe('15/01/2026 11:05:00');
  });

  it('writes midnight as 00, never 24', () => {
    expect(romeDateTime('2026-07-01T22:00:00Z')).toBe('02/07/2026 00:00:00');
    expect(romeDateTime('2026-01-14T23:00:07Z')).toBe('15/01/2026 00:00:07');
  });

  it('keeps the seconds and pads every part', () => {
    expect(romeDateTime('2026-03-05T08:04:09.123456+00:00')).toBe('05/03/2026 09:04:09');
  });

  it('leaves the cell empty when there is no date', () => {
    expect(romeDateTime(null)).toBe('');
  });

  it('rejects a value that is not a date', () => {
    expect(() => romeDateTime('ieri')).toThrow(RangeError);
  });
});

describe('romeDateStamp and exportFileName', () => {
  it('uses the calendar day in Rome', () => {
    expect(romeDateStamp(new Date('2026-11-17T23:30:00Z'))).toBe('2026-11-18');
    expect(romeDateStamp(new Date('2026-07-01T21:59:59Z'))).toBe('2026-07-01');
  });

  it('names the files with the day in Rome at 23:30 UTC', () => {
    const now = new Date('2026-11-17T23:30:00Z');
    expect(exportFileName('movements', now)).toBe('enjoy-movimenti-2026-11-18.csv');
    expect(exportFileName('customers', now)).toBe('enjoy-clienti-2026-11-18.csv');
  });
});

describe('with a process time zone other than Rome', () => {
  beforeAll(() => {
    // vi.stubEnv writes process.env.TZ, which Node re-reads on assignment: local time moves to
    // Los Angeles, Rome must not.
    vi.stubEnv('TZ', 'America/Los_Angeles');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('still writes the time and the file day of Rome', () => {
    const now = new Date('2026-11-17T23:30:00Z');
    // Guard: the process really runs on Los Angeles time (UTC-8 in November), where it is the 17th.
    expect(now.getTimezoneOffset()).toBe(480);
    expect(now.getDate()).toBe(17);
    expect(romeDateTime('2026-11-17T23:30:00Z')).toBe('18/11/2026 00:30:00');
    expect(romeDateTime('2026-07-01T10:05:00Z')).toBe('01/07/2026 12:05:00');
    expect(exportFileName('movements', now)).toBe('enjoy-movimenti-2026-11-18.csv');
  });
});

describe('kindLabel', () => {
  it.each([
    ['purchase', 'Spesa'],
    ['redemption', 'Riscatto'],
    ['correction', 'Correzione'],
  ] as const)('%s → %s', (kind, label) => {
    expect(kindLabel(kind)).toBe(label);
  });
});
