// The "Movimenti" file (SPEC-export, points 4 and 5): one record per movement, in the order of the
// server (created_at, then id). Amount and ratio only on purchases, the corrected movement only on
// corrections. An anonymized customer's name arrives null from the server and is written blank.

import { guardFormula, toCsv } from './csv';
import { centsToEuroCell, kindLabel, romeDateTime } from './formatExport';
import type { MovementExportRow } from './types';

export const MOVEMENTS_HEADER = [
  'Data e ora',
  'Codice movimento',
  'Codice cliente',
  'Cliente',
  'Tipo',
  'Importo €',
  'Punti',
  'Euro per punto',
  'Premio o descrizione',
  'Operatore',
  'Annulla il movimento',
  'Annullato da',
] as const;

function freeText(value: string | null): string {
  return value === null ? '' : guardFormula(value);
}

function euroCell(cents: number | null): string {
  return cents === null ? '' : centsToEuroCell(cents);
}

function toCells(row: MovementExportRow): string[] {
  const purchase = row.kind === 'purchase';
  return [
    romeDateTime(row.createdAt),
    row.id,
    row.customerId,
    freeText(row.customerName),
    kindLabel(row.kind),
    purchase ? euroCell(row.amountCents) : '',
    String(row.points),
    purchase ? euroCell(row.centsPerPoint) : '',
    freeText(row.description),
    freeText(row.operatorName),
    row.kind === 'correction' ? (row.correctsMovementId ?? '') : '',
    row.correctedByMovementId ?? '',
  ];
}

/** The whole "Movimenti" CSV text; with no rows, only the header. */
export function buildMovementsCsv(rows: readonly MovementExportRow[]): string {
  return toCsv(MOVEMENTS_HEADER, rows.map(toCells));
}
