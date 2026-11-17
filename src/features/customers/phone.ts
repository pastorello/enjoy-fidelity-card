/**
 * Phone numbers of customers: normalization to E.164 (mirrors the server's rule, used for the
 * client-side preview and validation) and the masked forms shown on screen. See SPEC-customers.md,
 * "Telefono" and "Ricerca".
 */

const E164 = /^\+[1-9][0-9]{6,14}$/;
const ITALY = '+39';
const MASK = '•••';

/** Spaces, dots, dashes, slashes and parentheses are dropped; `00` means `+`; no prefix means +39. */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s.\-/()]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith('+')) digits = `${ITALY}${digits}`;
  return E164.test(digits) ? digits : null;
}

/** List form: "••• 4521". */
export function maskPhone(phone: string): string {
  return `${MASK} ${phone.slice(-4)}`;
}

/**
 * Two-digit ITU country codes; 1 and 7 are the only one-digit ones and every other code has three
 * digits (ITU-T E.164 assignment by zone).
 */
const TWO_DIGIT_COUNTRY_CODES = new Set(
  (
    '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 ' +
    '60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'
  ).split(' '),
);

function countryCodeLength(digits: string): number {
  if (digits.startsWith('1') || digits.startsWith('7')) return 1;
  return TWO_DIGIT_COUNTRY_CODES.has(digits.slice(0, 2)) ? 2 : 3;
}

/**
 * Customer profile form: "333 ••• 4521" for Italian numbers (first 3 national digits), "+44 ••• 4521"
 * for the others. When the national part is too short to hide at least one digit, the list form is
 * used instead, so the whole number is never on screen.
 */
export function formatPhoneForCard(phone: string): string {
  if (phone.startsWith(ITALY)) {
    const national = phone.slice(ITALY.length);
    return national.length > 7 ? `${national.slice(0, 3)} ${maskPhone(phone)}` : maskPhone(phone);
  }
  const digits = phone.slice(1);
  return `+${digits.slice(0, countryCodeLength(digits))} ${maskPhone(phone)}`;
}

/** Edit form: Italian national digits grouped 3-3-rest ("333 123 4521"), E.164 for the others. */
export function formatPhoneForEdit(phone: string): string {
  if (!phone.startsWith(ITALY)) return phone;
  const national = phone.slice(ITALY.length);
  return [national.slice(0, 3), national.slice(3, 6), national.slice(6)].filter(Boolean).join(' ');
}

export type QueryKind = 'phone' | 'name' | 'none';

const PHONE_SEPARATORS = /[\s+\-.]/g;
const MIN_PHONE_DIGITS = 3;
const MIN_NAME_CHARACTERS = 2;

/**
 * Search text: only digits (ignoring spaces, `+`, `-`, `.`) and at least 3 of them → phone; a digits-only
 * text shorter than that → none; otherwise at least 2 characters → name.
 */
export function classifyQuery(text: string): QueryKind {
  const digits = text.replace(PHONE_SEPARATORS, '');
  if (digits === '') return 'none';
  if (/^[0-9]+$/.test(digits)) return digits.length >= MIN_PHONE_DIGITS ? 'phone' : 'none';
  return Array.from(text.trim()).length >= MIN_NAME_CHARACTERS ? 'name' : 'none';
}
