import { describe, expect, it } from 'vitest';
import { findPrivilegedKeys } from './privilegedKeys.ts';

// SPEC-operators, criterion 5: the detector the criteria test and check:bundle use. The keys below are
// made up and assembled at run time, so this file never holds anything shaped like a real key.

const SECRET_PREFIX = ['sb', 'secret', ''].join('_');
const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (payload: object) =>
  `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.${'s'.repeat(43)}`;

describe('findPrivilegedKeys', () => {
  it('finds nothing in ordinary code', () => {
    expect(
      findPrivilegedKeys('const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;'),
    ).toEqual([]);
  });

  it('finds a secret API key in any text', () => {
    const key = `${SECRET_PREFIX}${'Ab3-_x'.repeat(5)}Zz`;
    expect(findPrivilegedKeys(`SUPABASE_SECRET_KEY="${key}"`)).toEqual(['secret API key']);
  });

  it('ignores the bare prefix and the short made-up keys of the unit tests', () => {
    expect(findPrivilegedKeys(`startsWith('${SECRET_PREFIX}')`)).toEqual([]);
    expect(findPrivilegedKeys(`'${SECRET_PREFIX}abc'`)).toEqual([]);
  });

  it('finds a legacy service_role JWT, not the anon one', () => {
    expect(
      findPrivilegedKeys(`key: ${jwt({ iss: 'supabase-demo', role: 'service_role' })}`),
    ).toEqual(['service_role JWT']);
    expect(findPrivilegedKeys(`key: ${jwt({ iss: 'supabase-demo', role: 'anon' })}`)).toEqual([]);
  });

  it('finds a JWT of the database owner too', () => {
    expect(findPrivilegedKeys(jwt({ role: 'supabase_admin' }))).toEqual(['service_role JWT']);
  });

  it('ignores a token whose payload is not JSON', () => {
    expect(findPrivilegedKeys(`eyJhbGciOi.eyJ${'!'.repeat(3)}.abc`)).toEqual([]);
    expect(findPrivilegedKeys(`${base64url({ alg: 'HS256' })}.eyJub3QganNvbg.abc`)).toEqual([]);
  });

  it('reports each kind once, however many keys a text holds', () => {
    const key = `${SECRET_PREFIX}${'k'.repeat(31)}`;
    const admin = jwt({ role: 'service_role' });
    expect(findPrivilegedKeys(`${key} ${key} ${admin} ${admin}`)).toEqual([
      'secret API key',
      'service_role JWT',
    ]);
  });
});
