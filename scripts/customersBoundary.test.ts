import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC-customers, "Code Style": only supabaseCustomerService.ts reaches app.customers or calls the
// customers RPCs; components use CustomerService through the module's hooks, never getSupabase().

const SRC = 'src';
const SERVICE = 'src/features/customers/supabaseCustomerService.ts';
const RPCS = [
  'list_customers',
  'search_customers',
  'customers_served_today',
  'get_customer',
  'create_customer',
  'update_customer',
  'anonymize_customer',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [relative('.', path).split('\\').join('/')];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('customers data boundary', () => {
  it('finds the application sources', () => {
    expect(files.map((file) => file.path)).toContain(SERVICE);
  });

  it('lets only the Supabase customer service query app.customers or call its RPCs', () => {
    const access = new RegExp(
      `\\.from\\(\\s*['"\`]customers['"\`]|['"\`](${RPCS.join('|')})['"\`]`,
    );
    const offenders = files.filter((file) => access.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([SERVICE]);
  });

  it('imports the Supabase customer service only where it is injected (main.tsx)', () => {
    const importer = /from\s+['"][^'"]*supabaseCustomerService['"]/;
    const offenders = files
      .filter((file) => importer.test(file.text))
      .map((file) => file.path)
      .filter((path) => path !== 'src/main.tsx');
    expect(offenders).toEqual([]);
  });

  it('keeps getSupabase() out of the customers feature, except in its service', () => {
    const offenders = files
      .filter((file) => file.path.startsWith('src/features/customers/'))
      .filter((file) => file.path !== SERVICE)
      .filter((file) => /\bgetSupabase\b/.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  // SPEC-customers, Boundaries/Always: the phone only finds the customer, it never contacts them.
  it('has no tel: or sms: link anywhere in the app', () => {
    const contact = /\b(tel|sms):/i;
    const offenders = files.filter((file) => contact.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

// SPEC-customers-v2, point 1 and Success Criterion 1: the customer's phone is gone. No identifier,
// interface text or E.164-like literal of it may come back in src/, e2e/, tests/, scripts/ or the
// seed. This file is excluded: it has to spell the patterns out.
const SELF = 'scripts/customersBoundary.test.ts';
const PHONE_ROOTS = ['src', 'e2e', 'tests', 'scripts'];
const SEED = 'supabase/seed.sql';

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return allFiles(path);
    return [relative('.', path).split('\\').join('/')];
  });
}

/**
 * The phone as a property, field, parameter or column. `phone:` is a key only when no word precedes
 * it (`{ phone: …`, `, phone?: …`, `(phone: Page`) or a TypeScript modifier does: the device sense
 * in prose ("held to the phone: every scan…", "on the phone: never written") is a word, a space, then
 * "phone:", and stays allowed as the spec intends. The Playwright project of the phone viewport
 * (`name: 'phone'`, a device) is the one quoted 'phone' that is not the customer's.
 */
const PHONE_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  {
    label: 'phone:',
    pattern:
      /(?<![A-Za-z']\s)\bphone\??\s*:|\b(?:readonly|public|private|protected)\s+phone\??\s*:/,
  },
  { label: '.phone', pattern: /\.phone/ },
  { label: 'p_phone', pattern: /p_phone/ },
  { label: "'phone'", pattern: /(?<!name: )'phone'/ },
  { label: 'normalize_phone', pattern: /normalize_phone/ },
  { label: 'maskPhone', pattern: /maskPhone/ },
  { label: 'phone_invalid', pattern: /phone_invalid/ },
  { label: '«Telefono»', pattern: /Telefono/ },
  { label: '«Senza telefono»', pattern: /Senza telefono/i },
  { label: '«Tel.»', pattern: /\bTel\./ },
  { label: 'E.164 +39…', pattern: /\+39\d{6,}/ },
];

/** The `label`s of the phone patterns `text` contains. */
function phoneMatches(text: string): string[] {
  return PHONE_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

const phoneScope = [...PHONE_ROOTS.flatMap(allFiles), SEED].filter((path) => path !== SELF);

describe('customers v2: no customer phone left', () => {
  it('scans src, e2e, tests, scripts and the seed, without this file', () => {
    expect(phoneScope).toEqual(
      expect.arrayContaining([SEED, 'src/main.tsx', 'e2e/customers.spec.ts']),
    );
    expect(phoneScope.some((path) => path.startsWith('tests/integration/'))).toBe(true);
    expect(phoneScope).not.toContain(SELF);
  });

  it('finds no phone identifier, phone text or phone number', () => {
    const offenders = phoneScope.flatMap((path) =>
      phoneMatches(readFileSync(path, 'utf8')).map((label) => `${path}: ${label}`),
    );
    expect(offenders).toEqual([]);
  });

  it.each([
    ['{ name: x, phone: y }', 'phone:'],
    ['  phone?: string | null;', 'phone:'],
    ['readonly phone: string', 'phone:'],
    ['function setPin(phone: Page) {}', 'phone:'],
    ['row.phone', '.phone'],
    ["rpc('create_customer', { p_phone: null })", 'p_phone'],
    ["select('phone')", "'phone'"],
    ['private.normalize_phone(text)', 'normalize_phone'],
    ['maskPhone(value)', 'maskPhone'],
    ["raise exception 'phone_invalid'", 'phone_invalid'],
    ['<label>Telefono (facoltativo)</label>', '«Telefono»'],
    ['<p>Senza telefono</p>', '«Senza telefono»'],
    ['<p>Tel. 333</p>', '«Tel.»'],
    ["values ('Maria', '+393330000001')", 'E.164 +39…'],
  ])('catches %s', (text, label) => {
    expect(phoneMatches(text)).toContain(label);
  });

  it.each([
    '// A card held to the phone: every active scan reports it',
    "it('is not a card on the phone: never written', () => {})",
    '/** False until the person sets a PIN from their own phone: shown disabled. */',
    "const openPhone = () => phone.on('dialog', accept);",
    "      name: 'phone',",
    'function setPinFromPhone(operatorPhone: Page) {}',
  ])('lets the device sense through: %s', (text) => {
    expect(phoneMatches(text)).toEqual([]);
  });
});

// SPEC-customers-v2, Boundaries/Never: the email finds the customer, it never writes to them.
describe('customers v2: no mailto: link', () => {
  // A link is a quoted mailto: or an href template; a comment that names `mailto:` is no link.
  const MAILTO = /['"]mailto:|href\s*=\s*\{?\s*`mailto:/i;

  it.each([`<a href="mailto:a@example.com">`, 'href={`mailto:${email}`}', "'mailto:' + email"])(
    'catches %s',
    (text) => {
      expect(MAILTO.test(text)).toBe(true);
    },
  );

  it('has no mailto: link anywhere in the app', () => {
    const offenders = files.filter((file) => MAILTO.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
