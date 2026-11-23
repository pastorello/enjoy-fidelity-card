import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_ERROR_CODES } from '../src/features/cards/supabaseCardsService';
import { CUSTOMER_ERROR_CODES } from '../src/features/customers/errorCodes';

// errorCodes.ts is the single list of the customers RPCs' message-codes: a code raised by the
// migrations but missing from the list would reach the user untranslated as 'unknown'.

const MIGRATIONS = 'supabase/migrations';

/** The message-codes the migrations whose name matches `pattern` raise with errcode P0001, sorted. */
function raisedCodes(pattern: RegExp): string[] {
  const files = readdirSync(MIGRATIONS).filter((name) => pattern.test(name));
  if (files.length === 0) throw new Error(`no migration matches ${String(pattern)}`);
  const codes = files.flatMap((name) =>
    [
      ...readFileSync(join(MIGRATIONS, name), 'utf8').matchAll(
        /raise exception '([a-z_]+)'\s+using errcode = 'P0001'/g,
      ),
    ].map((match) => match[1] ?? ''),
  );
  return [...new Set(codes)].toSorted((a, b) => a.localeCompare(b));
}

const sorted = (codes: readonly string[]) => codes.toSorted((a, b) => a.localeCompare(b));

describe('customer error codes', () => {
  it('lists each code once', () => {
    expect(new Set(CUSTOMER_ERROR_CODES).size).toBe(CUSTOMER_ERROR_CODES.length);
  });

  it('lists exactly the codes the customers migrations raise', () => {
    // customers_v2_email redefines create_customer_with_card too: its card codes are CARD_ERROR_CODES.
    const cardOnly = new Set<string>(
      CARD_ERROR_CODES.filter(
        (code) => !(CUSTOMER_ERROR_CODES as readonly string[]).includes(code),
      ),
    );
    const raised = raisedCodes(/_customers(_v2_[a-z0-9_]+)?\.sql$/).filter(
      (code) => !cardOnly.has(code),
    );
    expect(raised).toEqual(expect.arrayContaining(['email_invalid', 'customer_email_taken']));
    expect(sorted(CUSTOMER_ERROR_CODES)).toEqual(raised);
  });
});
