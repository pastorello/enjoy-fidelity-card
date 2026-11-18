import {
  correctionText,
  formatMovementDate,
  formatSignedPoints,
  groupByDay,
  movementLabel,
} from './formatMovement';
import type { Movement } from './types';

// Every expectation is in Europe/Rome; the CI runs in UTC, so a test that leaned on the
// device's time zone would fail there (and the instants below sit where UTC and Rome differ).

function movement(overrides: Partial<Movement>): Movement {
  return {
    id: 'm1',
    operationId: 'op1',
    customerId: 'c1',
    kind: 'purchase',
    amountCents: 1500,
    points: 15,
    centsPerPoint: 100,
    rewardId: null,
    description: null,
    operatorId: 'u1',
    operatorName: 'Giulia',
    createdAt: '2026-11-18T09:42:00Z',
    correctsMovementId: null,
    cancelledById: null,
    cancelledAt: null,
    correctedKind: null,
    correctedCreatedAt: null,
    ...overrides,
  };
}

describe('movementLabel', () => {
  it('names a purchase with its amount', () => {
    // A non-breaking space before €, as formatCents.
    expect(movementLabel(movement({ amountCents: 1500 }))).toBe('Spesa 15,00\u00a0€');
  });

  it('names a redemption with the reward', () => {
    const redemption = movement({
      kind: 'redemption',
      amountCents: null,
      points: -50,
      centsPerPoint: null,
      description: 'Caffè',
    });
    expect(movementLabel(redemption)).toBe('Premio: Caffè');
  });

  it('names a correction', () => {
    const correction = movement({ kind: 'correction', amountCents: null, points: -15 });
    expect(movementLabel(correction)).toBe('Correzione');
  });
});

describe('formatSignedPoints', () => {
  it('signs gains with "+" and losses with the typographic minus', () => {
    expect(formatSignedPoints(15)).toBe('+15');
    expect(formatSignedPoints(-50)).toBe('−50');
  });

  it('groups thousands and leaves zero unsigned', () => {
    expect(formatSignedPoints(1250)).toBe('+1.250');
    expect(formatSignedPoints(-1250)).toBe('−1.250');
    expect(formatSignedPoints(0)).toBe('0');
  });
});

describe('formatMovementDate', () => {
  const now = new Date('2026-11-18T10:00:00Z'); // 11:00 in Rome

  it('says "Oggi" and "Ieri" with the time', () => {
    expect(formatMovementDate('2026-11-18T09:42:00Z', now)).toBe('Oggi 10:42');
    expect(formatMovementDate('2026-11-17T18:10:00Z', now)).toBe('Ieri 19:10');
  });

  it('shows day and month in the current year, the year otherwise', () => {
    expect(formatMovementDate('2026-11-08T17:05:00Z', now)).toBe('8 nov 18:05');
    expect(formatMovementDate('2025-11-08T17:05:00Z', now)).toBe('8 nov 2025 18:05');
  });

  it('splits the days at midnight in Rome, not in UTC', () => {
    // 23:30 UTC on 17 November is 00:30 on the 18th in Rome.
    expect(formatMovementDate('2026-11-17T23:30:00Z', now)).toBe('Oggi 00:30');
    expect(formatMovementDate('2026-11-17T22:59:00Z', now)).toBe('Ieri 23:59');
    // Just after midnight in Rome, while it is still the 17th in UTC.
    const justAfterMidnight = new Date('2026-11-17T23:10:00Z');
    expect(formatMovementDate('2026-11-17T22:50:00Z', justAfterMidnight)).toBe('Ieri 23:50');
    expect(formatMovementDate('2026-11-17T23:05:00Z', justAfterMidnight)).toBe('Oggi 00:05');
  });

  it('keeps "Ieri" right across the end of summer time (a 25-hour day)', () => {
    // Sunday 25 October 2026: 03:00 CEST becomes 02:00 CET.
    const mondayMorning = new Date('2026-10-26T10:00:00Z');
    expect(formatMovementDate('2026-10-24T22:30:00Z', mondayMorning)).toBe('Ieri 00:30');
    expect(formatMovementDate('2026-10-25T22:30:00Z', mondayMorning)).toBe('Ieri 23:30');
    expect(formatMovementDate('2026-10-25T23:30:00Z', mondayMorning)).toBe('Oggi 00:30');
    expect(formatMovementDate('2026-10-24T21:30:00Z', mondayMorning)).toBe('24 ott 23:30');
    // Late on the Monday, 24 hours earlier is still Sunday.
    const mondayNight = new Date('2026-10-26T22:30:00Z'); // 23:30 CET
    expect(formatMovementDate('2026-10-25T22:45:00Z', mondayNight)).toBe('Ieri 23:45');
  });

  it('keeps "Ieri" right across the start of summer time (a 23-hour day)', () => {
    // Sunday 29 March 2026: 02:00 CET becomes 03:00 CEST.
    const mondayNight = new Date('2026-03-30T21:30:00Z'); // 23:30 CEST
    expect(formatMovementDate('2026-03-28T23:30:00Z', mondayNight)).toBe('Ieri 00:30');
    expect(formatMovementDate('2026-03-29T21:45:00Z', mondayNight)).toBe('Ieri 23:45');
    expect(formatMovementDate('2026-03-28T22:45:00Z', mondayNight)).toBe('28 mar 23:45');
  });

  it('reads the year in Rome on New Year', () => {
    const newYear = new Date('2027-01-01T08:00:00Z');
    expect(formatMovementDate('2026-12-31T22:30:00Z', newYear)).toBe('Ieri 23:30');
    expect(formatMovementDate('2026-12-30T10:00:00Z', newYear)).toBe('30 dic 2026 11:00');
  });
});

describe('groupByDay', () => {
  const now = new Date('2026-11-18T10:00:00Z');

  it('groups newest first under OGGI, IERI and the day, keeping the order', () => {
    const list = [
      movement({ id: 'a', createdAt: '2026-11-18T09:42:00Z' }),
      movement({ id: 'b', createdAt: '2026-11-17T23:30:00Z' }), // 00:30 on the 18th in Rome
      movement({ id: 'c', createdAt: '2026-11-17T22:59:00Z' }), // 23:59 on the 17th in Rome
      movement({ id: 'd', createdAt: '2026-11-17T08:00:00Z' }),
      movement({ id: 'e', createdAt: '2026-11-08T17:05:00Z' }),
      movement({ id: 'f', createdAt: '2025-11-08T17:05:00Z' }),
    ];
    const groups = groupByDay(list, now);
    expect(groups.map((group) => group.title)).toEqual([
      'OGGI',
      'IERI',
      '8 NOVEMBRE',
      '8 NOVEMBRE 2025',
    ]);
    expect(groups.map((group) => group.movements.map((m) => m.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
      ['f'],
    ]);
    expect(groups.map((group) => group.key)).toEqual([
      '2026-11-18',
      '2026-11-17',
      '2026-11-08',
      '2025-11-08',
    ]);
  });

  it('splits across the end of summer time by the day in Rome', () => {
    const mondayMorning = new Date('2026-10-26T10:00:00Z');
    const list = [
      movement({ id: 'a', createdAt: '2026-10-25T23:30:00Z' }), // 26 Oct 00:30 CET
      movement({ id: 'b', createdAt: '2026-10-25T22:30:00Z' }), // 25 Oct 23:30 CET
      movement({ id: 'c', createdAt: '2026-10-24T22:30:00Z' }), // 25 Oct 00:30 CEST
      movement({ id: 'd', createdAt: '2026-10-24T21:30:00Z' }), // 24 Oct 23:30 CEST
    ];
    const groups = groupByDay(list, mondayMorning);
    expect(groups.map((group) => [group.title, group.movements.map((m) => m.id)])).toEqual([
      ['OGGI', ['a']],
      ['IERI', ['b', 'c']],
      ['24 OTTOBRE', ['d']],
    ]);
  });

  it('returns no group for no movement', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

function correctionOf(correctedKind: 'purchase' | 'redemption', correctedCreatedAt: string) {
  return movement({
    kind: 'correction',
    amountCents: null,
    centsPerPoint: null,
    points: -12,
    createdAt: '2026-11-18T17:12:00Z', // 18:12 in Rome
    correctsMovementId: 'm0',
    correctedKind,
    correctedCreatedAt,
  });
}

describe('correctionText', () => {
  it('gives only the time when the cancelled movement is of the same day', () => {
    expect(correctionText(correctionOf('purchase', '2026-11-18T17:05:00Z'))).toBe(
      'annulla la spesa delle 18:05',
    );
    expect(correctionText(correctionOf('redemption', '2026-11-18T09:45:00Z'))).toBe(
      'annulla il riscatto delle 10:45',
    );
  });

  it('adds the day when the cancelled movement is of another day', () => {
    expect(correctionText(correctionOf('purchase', '2026-11-07T17:05:00Z'))).toBe(
      'annulla la spesa del 7 nov alle 18:05',
    );
    expect(correctionText(correctionOf('redemption', '2026-11-07T17:05:00Z'))).toBe(
      'annulla il riscatto del 7 nov alle 18:05',
    );
  });

  it('compares the days in Rome', () => {
    // Correction at 00:05 on the 18th in Rome, purchase at 23:55 on the 17th: same UTC day.
    const lateNight = movement({
      kind: 'correction',
      createdAt: '2026-11-17T23:05:00Z',
      correctedKind: 'purchase',
      correctedCreatedAt: '2026-11-17T22:55:00Z',
    });
    expect(correctionText(lateNight)).toBe('annulla la spesa del 17 nov alle 23:55');
    // Correction at 00:30 on the 18th in Rome, purchase at 00:10 on the 18th: different UTC days.
    const sameRomeDay = movement({
      kind: 'correction',
      createdAt: '2026-11-17T23:30:00Z',
      correctedKind: 'purchase',
      correctedCreatedAt: '2026-11-17T23:10:00Z',
    });
    expect(correctionText(sameRomeDay)).toBe('annulla la spesa delle 00:10');
  });

  it('adds the year when the cancelled movement is of another year', () => {
    const newYear = movement({
      kind: 'correction',
      createdAt: '2027-01-01T08:00:00Z',
      correctedKind: 'purchase',
      correctedCreatedAt: '2026-12-31T22:30:00Z', // 23:30 on 31 December in Rome
    });
    expect(correctionText(newYear)).toBe('annulla la spesa del 31 dic 2026 alle 23:30');
  });

  it('has no text for a movement that is not a correction or misses the corrected one', () => {
    expect(correctionText(movement({}))).toBeNull();
    expect(correctionText(movement({ kind: 'correction' }))).toBeNull();
  });
});
