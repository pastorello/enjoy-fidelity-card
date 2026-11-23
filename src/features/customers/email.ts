// Mirror of private.normalize_email + private.check_email (migration customers_v2_email):
// the server stays the authority, this lets the form answer before a round trip.

/**
 * Whitespace trimmed at the edges: JavaScript's \s (which already holds the no-break, the
 * U+2000–U+200A spaces, the narrow no-break, the ideographic space and the BOM) plus the
 * zero-width space U+200B, like the server.
 */
const EDGE_SPACES = /^[\s  -​　]+|[\s  -​　]+$/g;

/** The format of customers_email_check: one @, something before it, a dot after it. */
const FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The stored form of an email typed by an operator, `null` when empty, or `'invalid'`. */
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- 'invalid' spells out the contract of SPEC-customers-v2 (Code Style); no valid email equals it.
export function normalizeEmail(input: string): string | null | 'invalid' {
  const email = input.replace(EDGE_SPACES, '').toLowerCase();
  if (email === '') return null;
  // Postgres length() counts characters, not UTF-16 code units.
  const length = Array.from(email).length;
  return length >= 6 && length <= 254 && FORMAT.test(email) ? email : 'invalid';
}
