import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Task 36 of tasks/customers-v2: the documents follow SPEC-customers-v2. No customer phone is left in
// docs/, CLAUDE.md, CAPABILITY-MAP.md, PRODUCT.md or the MAP (the device sense — "dal telefono", "sul telefono" — stays, and the old
// behaviour is told only by SPEC-customers-v2 itself); the RUNBOOK carries the release notes and the
// manual checks; no key, token or real address in any of them.

const DELTA = 'docs/specs/SPEC-customers-v2.md';
const RUNBOOK = 'brain/topics/operations/RUNBOOK.md';

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith('.md') ? [relative('.', path).split('\\').join('/')] : [];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');

const phoneFree = [
  ...markdownFiles('docs'),
  'CLAUDE.md',
  'CAPABILITY-MAP.md',
  'PRODUCT.md',
  'brain/MAP.md',
].filter((path) => path !== DELTA);

/**
 * The customer's phone as data: a column, parameter, function, form field, list text or a way to
 * search. The phone as a device ("dal proprio telefono", "sul telefono Android") matches none of them.
 */
const CUSTOMER_PHONE: readonly { label: string; pattern: RegExp }[] = [
  { label: 'phone column', pattern: /\bphone text\b|\bname, phone\b|\bphone, notes\b/ },
  { label: 'p_phone', pattern: /p_phone/ },
  { label: 'normalize_phone', pattern: /normalize_?phone/i },
  { label: 'mask/format phone', pattern: /(mask|format)Phone|phone\.ts|phone_invalid/ },
  {
    label: '«Telefono» field',
    pattern: /Telefono \(facoltativo\)|`Telefono`|Nome e cognome, Telefono/,
  },
  { label: '«Senza telefono»', pattern: /Senza telefono/i },
  { label: '«Tel.»', pattern: /\bTel\. / },
  { label: 'E.164', pattern: /\+39\s?\d{3}|E\.164/ },
  {
    label: 'search by phone',
    pattern: /(cerca|trova)\w*[^.\n]{0,20}\bper telefono|\bo telefono\b|cifre del telefono/,
  },
  {
    label: 'phone as personal data',
    pattern: /(nome|nomi),? (e )?telefon|telefono e note|telefoni\b/i,
  },
];

function customerPhones(text: string): string[] {
  return CUSTOMER_PHONE.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

describe('documents without the customer phone', () => {
  it('scans docs/, CLAUDE.md, CAPABILITY-MAP, PRODUCT and the MAP, without the delta spec', () => {
    expect(phoneFree).toEqual(
      expect.arrayContaining([
        'CLAUDE.md',
        'brain/MAP.md',
        'docs/setup-accounts.md',
        'docs/specs/contract.md',
        'docs/specs/SPEC-customers.md',
      ]),
    );
    expect(phoneFree).not.toContain(DELTA);
  });

  it('finds no customer phone', () => {
    const offenders = phoneFree.flatMap((path) =>
      read(path)
        .split('\n')
        .flatMap((line, index) =>
          customerPhones(line).map((label) => `${path}:${index + 1}: ${label}`),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it.each([
    ['`phone text null` (E.164)', 'phone column'],
    ['(id, name, phone, notes, anonymized_at)', 'phone column'],
    ['create_customer(p_operation_id, p_name, p_phone)', 'p_phone'],
    ['private.normalize_phone(text)', 'normalize_phone'],
    ['"Telefono (facoltativo)"', '«Telefono» field'],
    ['«Senza telefono»', '«Senza telefono»'],
    ['«Tel. 333 ••• 4521»', '«Tel.»'],
    ['+39 333 1234567', 'E.164'],
    ['cerca per nome o telefono', 'search by phone'],
    ['→ ricerca **per telefono**', 'search by phone'],
    ['Nome, telefono e note si cancellano', 'phone as personal data'],
    ['con nomi e telefoni', 'phone as personal data'],
  ])('catches %s', (text, label) => {
    expect(customerPhones(text)).toContain(label);
  });

  it.each([
    'La persona accede dal telefono su `/accedi`',
    'Ognuno imposta il proprio PIN **dal proprio telefono**',
    'Tutto in una colonna, come sul telefono',
    '1. Telefono, app Enjoy Card → **Impostazioni**',
    '## Frontend routes (phone, all behind RequireAuth except auth pages)',
    'accanto al progetto "phone").',
    'Il telefono del cliente non si raccoglie più',
    'Saldo-card-non-attiva (pagina "Telefono", tavole definitive',
    'Interfaccia per telefono (390×844) e tablet',
    'ignorati da `phone`) e `tablet-settings`',
  ])('lets the device sense through: %s', (text) => {
    expect(customerPhones(text)).toEqual([]);
  });
});

describe('RUNBOOK, customers-v2', () => {
  const text = read(RUNBOOK);

  it('has the release notes of the spec', () => {
    for (const step of [
      'Open Question 17',
      'bar chiuso',
      'vacuum full app.customers;',
      "notes ~ '\\+?\\d[\\d .-]{7,}'",
      'SPEC-customers-v2',
    ]) {
      expect(text).toContain(step);
    }
  });

  it('has the manual checks', () => {
    for (const step of ['Riformatta', 'NTAG215', 'list_customers', '500 ms', '320 px', 'iPhone']) {
      expect(text).toContain(step);
    }
  });
});

describe('CLAUDE.md, contract and MAP', () => {
  it('name the email and the /card/:cardId route', () => {
    expect(read('CLAUDE.md')).toContain('/card/:cardId');
    expect(read('docs/specs/contract.md')).toMatch(/`email text null`/);
    expect(read('brain/MAP.md')).toContain('SPEC-customers-v2');
  });
});

describe('no secret and no real contact in the documents', () => {
  const documents = [...markdownFiles('docs'), 'CLAUDE.md', 'brain/MAP.md', RUNBOOK];

  it('has no JWT, Supabase secret key or service role key', () => {
    const secret = /eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]|service_role[^\n]*=\s*\S{20,}/;
    expect(documents.filter((path) => secret.test(read(path)))).toEqual([]);
  });

  it('has only fake or the bar’s own email addresses', () => {
    // `nome@esempio.it` is the placeholder of the email fields, `qualcosa@dominio.estensione` the
    // shape the delta spec describes: neither is anybody's address.
    const allowed =
      /@(example\.com|enjoygaeta\.it)$|^nome@esempio\.it$|^qualcosa@dominio\.estensione$/i;
    const offenders = documents.flatMap((path) =>
      (read(path).match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])
        .filter((address) => !allowed.test(address))
        .map((address) => `${path}: ${address}`),
    );
    expect(offenders).toEqual([]);
  });
});
