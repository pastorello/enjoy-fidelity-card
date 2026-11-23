import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUSTOMER_ERROR_CODES } from '../src/features/customers/errorCodes';
import { CARD_ERROR_CODES } from '../src/features/cards/supabaseCardsService';

// SPEC-cards, "Modello dati": supabaseCardsService translates every message-code the cards RPCs raise
// (errcode P0001) into a typed error. A code raised by the migration but missing from
// CARD_ERROR_CODES would reach the screens as 'unknown'. create_customer_with_card also raises the
// codes of app.create_customer, which the service hands on as CustomerError.

const MIGRATIONS = 'supabase/migrations';

/**
 * The customer phone's code (SPEC-customers-v2, point 1): still raised by the migrations, never by a
 * call of the app, which sends no phone. It leaves the migrations with task 25, this list with task 26.
 */
const RETIRED_CUSTOMER_CODES: ReadonlySet<string> = new Set(['phone_invalid']);

/** The message-codes the migrations ending in `suffix` raise with errcode P0001, sorted. */
function raisedCodes(suffix: string): string[] {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix));
  if (files.length === 0) throw new Error(`no ${suffix} migration`);
  const codes = files.flatMap((name) =>
    [
      ...readFileSync(join(MIGRATIONS, name), 'utf8').matchAll(
        /raise exception '([a-z_]+)'\s+using errcode = 'P0001'/g,
      ),
    ].map((match) => match[1] ?? ''),
  );
  return [...new Set(codes)].toSorted((a, b) => a.localeCompare(b));
}

describe('card error codes', () => {
  it('lists exactly the codes the cards migration raises, once each', () => {
    const raised = raisedCodes('_cards.sql');
    expect(raised.length).toBeGreaterThan(0);
    expect(new Set(CARD_ERROR_CODES).size).toBe(CARD_ERROR_CODES.length);
    expect(CARD_ERROR_CODES.toSorted((a, b) => a.localeCompare(b))).toEqual(raised);
  });

  it('translates every code app.create_customer can raise inside create_customer_with_card', () => {
    const translated = new Set<string>([...CARD_ERROR_CODES, ...CUSTOMER_ERROR_CODES]);
    const untranslated = raisedCodes('_customers.sql').filter(
      (code) => !translated.has(code) && !RETIRED_CUSTOMER_CODES.has(code),
    );
    expect(untranslated).toEqual([]);
  });
});
