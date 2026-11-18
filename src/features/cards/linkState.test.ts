import { describe, expect, it } from 'vitest';
import { linkStateOf } from './linkState';

// SPEC-cards, "Modello dati": not-written when link_written_at is null, unverified when
// link_pending_at > link_written_at, written otherwise.

describe('linkStateOf', () => {
  it('is not-written without a written link', () => {
    expect(linkStateOf(null, null)).toBe('not-written');
  });

  it('is not-written while the first link is only pending', () => {
    expect(linkStateOf(null, '2026-11-18T09:00:00+00:00')).toBe('not-written');
  });

  it('is written with a written link and nothing pending', () => {
    expect(linkStateOf('2026-11-18T09:00:00+00:00', null)).toBe('written');
  });

  it('is unverified when a newer link was issued after the written one', () => {
    expect(linkStateOf('2026-11-18T09:00:00+00:00', '2026-11-18T09:05:00+00:00')).toBe(
      'unverified',
    );
  });

  it('is written when the pending instant is not later than the written one', () => {
    expect(linkStateOf('2026-11-18T09:05:00+00:00', '2026-11-18T09:00:00+00:00')).toBe('written');
    expect(linkStateOf('2026-11-18T09:05:00+00:00', '2026-11-18T09:05:00+00:00')).toBe('written');
  });

  it('tells apart instants within the same millisecond (Postgres keeps microseconds)', () => {
    expect(
      linkStateOf('2026-11-18T09:00:00.123401+00:00', '2026-11-18T09:00:00.123402+00:00'),
    ).toBe('unverified');
    expect(linkStateOf('2026-11-18T09:00:00.1234+00:00', '2026-11-18T09:00:00.12341+00:00')).toBe(
      'unverified',
    );
    expect(linkStateOf('2026-11-18T09:00:00.12341+00:00', '2026-11-18T09:00:00.1234+00:00')).toBe(
      'written',
    );
  });

  it('compares instants across time zones and without a fraction', () => {
    expect(linkStateOf('2026-11-18T10:00:00+01:00', '2026-11-18T09:00:00.5Z')).toBe('unverified');
    expect(linkStateOf('2026-11-18T09:00:01Z', '2026-11-18T09:00:00.999999+00')).toBe('written');
  });
});
