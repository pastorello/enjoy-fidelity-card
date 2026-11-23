import { describe, expect, it } from 'vitest';
import { CARD_ERROR_CODES } from '../src/features/cards/supabaseCardsService';
import { CUSTOMER_ERROR_CODES } from '../src/features/customers/errorCodes';
import { liveFunctionsIn, raisedMessageCodes } from './migrationFunctions';

// errorCodes.ts is the single list of the customers RPCs' message-codes: a code raised by the
// migrations but missing from the list would reach the user untranslated as 'unknown'. The codes are
// those of the latest definition of each function still present whose latest definition is in a
// `_customers*.sql` migration (SPEC-customers-v2, "Codici d'errore"): the functions dropped by
// customers_v2_email (the phone normalizer, app.search_customers, app.customers_served_today)
// and the old app.create_customer / app.update_customer no longer count.

const CUSTOMER_MIGRATIONS = /_customers[a-z0-9_]*\.sql$/;

const sorted = (codes: readonly string[]) => codes.toSorted((a, b) => a.localeCompare(b));

const aboutPhone = (codes: readonly string[]) => codes.filter((code) => /phone/.test(code));

function raisedCustomerCodes(): string[] {
  // customers_v2_email redefines create_customer_with_card too: its card codes are CARD_ERROR_CODES.
  const cardOnly = new Set<string>(
    CARD_ERROR_CODES.filter((code) => !(CUSTOMER_ERROR_CODES as readonly string[]).includes(code)),
  );
  return raisedMessageCodes(liveFunctionsIn(CUSTOMER_MIGRATIONS)).filter(
    (code) => !cardOnly.has(code),
  );
}

describe('customer error codes', () => {
  it('lists each code once', () => {
    expect(new Set(CUSTOMER_ERROR_CODES).size).toBe(CUSTOMER_ERROR_CODES.length);
  });

  it('requires the email codes and has no phone code left (SPEC-customers-v2, points 1 and 2)', () => {
    const raised = raisedCustomerCodes();
    expect(raised).toEqual(expect.arrayContaining(['email_invalid', 'customer_email_taken']));
    expect(aboutPhone(raised)).toEqual([]);
    expect(aboutPhone(CUSTOMER_ERROR_CODES)).toEqual([]);
  });

  it('lists exactly the codes the live customers functions raise', () => {
    expect(sorted(CUSTOMER_ERROR_CODES)).toEqual(raisedCustomerCodes());
  });
});
