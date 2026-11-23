// CSV text for Excel in Italian (SPEC-export, "Formato del file"): UTF-8 with a BOM, ';' as separator,
// CRLF after every record, quotes only where needed. Free text goes through guardFormula before it
// reaches toCsv; numbers and dates do not, so "-12,50" stays a number in Excel.

/** The UTF-8 byte order mark: without it Excel reads the file as ANSI and breaks the accents. */
export const BOM = '﻿';

const SEPARATOR = ';';
const RECORD_END = '\r\n';
const NEEDS_QUOTES = /[;"\r\n]/;
// OWASP CSV injection: a cell starting with one of these may be read as a formula.
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);
// A card uid (upper-case hex); anything else is not trusted as a formula literal.
const EXCEL_TEXT_SAFE = /^[0-9A-F]{1,20}$/;

/** Quotes a field only if it holds ';', '"', CR or LF, doubling the quotes inside (RFC 4180). */
export function escapeField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Free text that could start a formula gets a leading apostrophe; anything else is unchanged. */
export function guardFormula(value: string): string {
  return FORMULA_TRIGGERS.has(value.charAt(0)) ? `'${value}` : value;
}

/**
 * A card uid as an Excel text formula (`="04A1…"`), so Excel keeps the leading zeros and never reads
 * it as a number. Only values made of digits and upper-case hex take that form; anything else is
 * written as guarded free text.
 */
export function excelText(value: string): string {
  return EXCEL_TEXT_SAFE.test(value) ? `="${value}"` : guardFormula(value);
}

function toRecord(cells: readonly string[]): string {
  return cells.map(escapeField).join(SEPARATOR) + RECORD_END;
}

/** The whole file: BOM, the header, then one record per row, each closed by CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return BOM + toRecord(header) + rows.map(toRecord).join('');
}
