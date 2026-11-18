// The "Clienti" file (SPEC-export, points 4 and 5): one record per customer, sorted by name in Italian
// with the anonymized ones last, by creation. The personal fields of an anonymized customer are blank
// here too, whatever the row holds: the server already sends them null, this is a second guard.

import { excelText, guardFormula, toCsv } from './csv';
import { romeDateTime } from './formatExport';
import type { CustomerExportRow } from './types';

export const CUSTOMERS_HEADER = [
  'Codice cliente',
  'Nome',
  'Telefono',
  'Card attiva',
  'Saldo punti',
  'Consenso privacy',
  'Note',
  'Creato il',
  'Creato da',
  'Anonimizzato il',
] as const;

// Equal ignoring case and accents ("Elia" = "Èlia"); the accent-aware collator then breaks the tie, so
// the order does not depend on the ids.
const byBaseLetters = new Intl.Collator('it-IT', { sensitivity: 'base' });
const byAccents = new Intl.Collator('it-IT');

function compareCustomers(a: CustomerExportRow, b: CustomerExportRow): number {
  const aAnonymized = a.anonymizedAt !== null;
  const bAnonymized = b.anonymizedAt !== null;
  if (aAnonymized !== bAnonymized) return aAnonymized ? 1 : -1;
  if (aAnonymized) {
    const byCreation = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (byCreation !== 0) return byCreation;
  } else {
    const aName = a.name ?? '';
    const bName = b.name ?? '';
    const byName = byBaseLetters.compare(aName, bName) || byAccents.compare(aName, bName);
    if (byName !== 0) return byName;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function personal(row: CustomerExportRow, value: string | null): string | null {
  return row.anonymizedAt === null ? value : null;
}

function toCells(row: CustomerExportRow): string[] {
  const name = personal(row, row.name);
  const phone = personal(row, row.phone);
  const uid = personal(row, row.activeCardUid);
  const notes = personal(row, row.notes);
  return [
    row.id,
    name === null ? '' : guardFormula(name),
    phone === null ? '' : excelText(phone),
    uid === null ? '' : excelText(uid),
    String(row.balancePoints),
    romeDateTime(row.privacyConsentAt),
    notes === null ? '' : guardFormula(notes),
    romeDateTime(row.createdAt),
    guardFormula(row.createdByName),
    romeDateTime(row.anonymizedAt),
  ];
}

/** The whole "Clienti" CSV text; with no rows, only the header. */
export function buildCustomersCsv(rows: readonly CustomerExportRow[]): string {
  return toCsv(CUSTOMERS_HEADER, rows.toSorted(compareCustomers).map(toCells));
}
