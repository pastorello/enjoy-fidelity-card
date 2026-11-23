import { describe, expect, it } from 'vitest';
import { parseCustomerList, toCustomerListRow } from './customerListRow';
import { CustomerError } from './types';

const ID = '6f1c2a5e-8b3d-4c7a-9e21-0d4b5f6a7c8e';

/** A row of `app.list_customers` as PostgREST returns it. */
const row = {
  id: ID,
  name: 'Maria Rossi',
  balance: 12,
  last_activity_at: '2026-11-23T10:15:00.123456+00:00',
  created_at: '2026-11-01T08:00:00.000001+00:00',
};

describe('toCustomerListRow', () => {
  it('maps the row to camelCase, keeping the timestamps as the strings received', () => {
    expect(toCustomerListRow(row)).toEqual({
      id: ID,
      name: 'Maria Rossi',
      balance: 12,
      lastActivityAt: '2026-11-23T10:15:00.123456+00:00',
      createdAt: '2026-11-01T08:00:00.000001+00:00',
    });
  });

  it('never turns the timestamps into dates (the microseconds would be lost)', () => {
    const mapped = toCustomerListRow(row);
    expect(typeof mapped?.lastActivityAt).toBe('string');
    expect(typeof mapped?.createdAt).toBe('string');
  });

  it('accepts a customer without purchases or redemptions', () => {
    expect(toCustomerListRow({ ...row, last_activity_at: null })).toMatchObject({
      lastActivityAt: null,
    });
  });

  it('needs no notes, anonymized_at nor last_served_at, and keeps nothing else', () => {
    const mapped = toCustomerListRow({ ...row, email: 'rossi@example.com', notes: 'x' });
    expect(mapped).not.toBeNull();
    expect(Object.keys(mapped ?? {}).toSorted()).toEqual([
      'balance',
      'createdAt',
      'id',
      'lastActivityAt',
      'name',
    ]);
  });

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['an array', [row]],
    ['id missing', { ...row, id: undefined }],
    ['name not a string', { ...row, name: 3 }],
    ['balance as text', { ...row, balance: '12' }],
    ['balance not an integer', { ...row, balance: 1.5 }],
    ['activity as a number', { ...row, last_activity_at: 1 }],
    ['created_at null', { ...row, created_at: null }],
    ['created_at missing', { ...row, created_at: undefined }],
  ])('rejects a row with the wrong shape (%s)', (_, data) => {
    expect(toCustomerListRow(data)).toBeNull();
  });
});

describe('parseCustomerList', () => {
  it('maps every row, in the order received', () => {
    const other = { ...row, id: '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b', name: 'Luca Bianchi' };
    expect(parseCustomerList([row, other]).map((item) => item.name)).toEqual([
      'Maria Rossi',
      'Luca Bianchi',
    ]);
  });

  it('an empty answer is an empty page', () => {
    expect(parseCustomerList([])).toEqual([]);
  });

  it.each([
    ['not an array', row],
    ['a row of the wrong shape', [row, { ...row, balance: null }]],
  ])('throws an unknown CustomerError for %s', (_, data) => {
    let thrown: unknown = null;
    try {
      parseCustomerList(data);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CustomerError);
    expect(thrown).toMatchObject({ kind: 'unknown' });
    expect(String(thrown)).not.toMatch(/Maria/);
  });
});
