import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUSTOMER_ERROR_CODES } from '../src/features/customers/errorCodes';
import { LEDGER_ERRCODES } from '../src/features/ledger/supabaseLedgerService';

// SPEC-ledger, "Modello dati": supabaseLedgerService translates every SQLSTATE the ledger RPCs raise
// (EC001…EC007, 42501, 22023) into a LedgerError kind. A code raised by a migration but missing from
// LEDGER_ERRCODES would reach the screens as 'unknown'. The ledger migration also replaces the
// customer reads (search_customers, get_customer, customers_served_today), which keep raising the
// P0001 message-codes of customers: those are translated by supabaseCustomerService, not here.

const MIGRATIONS = 'supabase/migrations';

function ledgerMigrations(): string[] {
  const files = readdirSync(MIGRATIONS).filter((name) => /_ledger[a-z_]*\.sql$/.test(name));
  if (files.length === 0) throw new Error('ledger migration not found');
  return files.map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'));
}

/** Every SQLSTATE the ledger migrations raise with `using errcode = '…'`, sorted. */
function raisedErrcodes(): string[] {
  const codes = ledgerMigrations().flatMap((text) =>
    [...text.matchAll(/errcode\s*=\s*'([0-9A-Z]{5})'/g)].map((match) => match[1] ?? ''),
  );
  return [...new Set(codes)].toSorted((a, b) => a.localeCompare(b));
}

/** The message-codes raised with errcode P0001 (the customer reads), sorted. */
function raisedMessageCodes(): string[] {
  const codes = ledgerMigrations().flatMap((text) =>
    [...text.matchAll(/raise exception '([^']*)'\s+using errcode = 'P0001'/g)].map(
      (match) => match[1] ?? '',
    ),
  );
  return [...new Set(codes)].toSorted((a, b) => a.localeCompare(b));
}

describe('ledger error codes', () => {
  it('translates exactly the SQLSTATEs the ledger migration raises', () => {
    const raised = raisedErrcodes().filter((code) => code !== 'P0001');
    expect(raised).toContain('EC001');
    expect(Object.keys(LEDGER_ERRCODES).toSorted((a, b) => a.localeCompare(b))).toEqual(raised);
  });

  it('raises P0001 only with message-codes the customer service translates', () => {
    const customerCodes = new Set<string>(CUSTOMER_ERROR_CODES);
    const untranslated = raisedMessageCodes().filter((code) => !customerCodes.has(code));
    expect(untranslated).toEqual([]);
    const p0001Raises = ledgerMigrations().flatMap((text) => [
      ...text.matchAll(/errcode\s*=\s*'P0001'/g),
    ]).length;
    const matched = ledgerMigrations().flatMap((text) => [
      ...text.matchAll(/raise exception '[^']*'\s+using errcode = 'P0001'/g),
    ]).length;
    // A P0001 raised any other way (a format string, a variable) would escape the check above.
    expect(matched).toBe(p0001Raises);
  });
});
