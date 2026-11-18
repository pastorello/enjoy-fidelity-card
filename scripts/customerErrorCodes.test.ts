import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUSTOMER_ERROR_CODES } from '../src/features/customers/errorCodes';

// errorCodes.ts is the single list of the customers RPCs' message-codes: a code raised by the
// migration but missing from the list would reach the user untranslated as 'unknown'.

const MIGRATIONS = 'supabase/migrations';

/** The message-codes the customers migration raises with errcode P0001, sorted. */
function raisedCodes(): string[] {
  const file = readdirSync(MIGRATIONS).find((name) => name.endsWith('_customers.sql'));
  if (!file) throw new Error('customers migration not found');
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  const codes = [...sql.matchAll(/raise exception '([a-z_]+)'\s+using errcode = 'P0001'/g)].map(
    (match) => match[1] ?? '',
  );
  return [...new Set(codes)].toSorted((a, b) => a.localeCompare(b));
}

describe('customer error codes', () => {
  it('lists exactly the codes the customers migration raises, once each', () => {
    expect(raisedCodes().length).toBeGreaterThan(0);
    expect(CUSTOMER_ERROR_CODES.toSorted((a, b) => a.localeCompare(b))).toEqual(raisedCodes());
  });
});
