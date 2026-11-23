import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './email';

// The same vectors as supabase/tests/customers_v2.test.sql: normalizeEmail mirrors
// private.normalize_email followed by private.check_email (customers_email_check).

const LOCAL_64 = 'a'.repeat(64);

describe('normalizeEmail', () => {
  it.each([
    ['  Rossi@Example.COM ', 'rossi@example.com'],
    ['ROSSI@example.com', 'rossi@example.com'],
    ['rossi@example.com', 'rossi@example.com'],
    ['  　Unicode@Example.COM ​﻿\t', 'unicode@example.com'],
    [' rossi@example.com \n', 'rossi@example.com'],
    ['ab@c.de', 'ab@c.de'],
    ['ada.attivita@example.com', 'ada.attivita@example.com'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each([[''], ['   '], [' 　​﻿\t']])('an empty %j is null', (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });

  it('accepts 6 characters and refuses 5', () => {
    expect(normalizeEmail('ab@c.de')).toBe('ab@c.de');
    expect(normalizeEmail('a@b.c')).toBe('invalid');
  });

  it('accepts 254 characters and refuses 255', () => {
    const at254 = `${LOCAL_64}@${'b'.repeat(185)}.com`;
    const at255 = `${LOCAL_64}@${'b'.repeat(186)}.com`;
    expect(at254).toHaveLength(254);
    expect(at255).toHaveLength(255);
    expect(normalizeEmail(at254)).toBe(at254);
    expect(normalizeEmail(at255)).toBe('invalid');
  });

  it('counts the length after trimming, like the server', () => {
    const at254 = `${LOCAL_64}@${'b'.repeat(185)}.com`;
    expect(normalizeEmail(`  ${at254.toUpperCase()}  `)).toBe(at254);
  });

  it('counts characters like Postgres length(), not UTF-16 code units', () => {
    const astral = `\u{1f600}${'a'.repeat(63)}@${'b'.repeat(185)}.com`;
    expect(astral).toHaveLength(255);
    expect(normalizeEmail(astral)).toBe(astral);
  });

  it.each([
    ['rossi@'],
    ['rossi@example'],
    ['rossiexample.com'],
    ['ro ssi@example.com'],
    ['rossi@@example.com'],
    ['@example.com'],
    ['rossi@.com'],
    ['rossi@example.'],
  ])('refuses the malformed %j', (input) => {
    expect(normalizeEmail(input)).toBe('invalid');
  });
});
