import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Task 26 of tasks/tablet-kiosk: the procedures of the till tablet are written down where the next
// person looks for them (SPEC-tablet-kiosk, points 1 and 14), with the two differences of the module
// (the /impostazioni/pin route beyond the contract, the PIN hash in `private` instead of identity's
// column) recalled, and no key, token or real address in any of them.

const SETUP_TABLET = 'docs/setup-tablet.md';
const SETUP_ACCOUNTS = 'docs/setup-accounts.md';
const RUNBOOK = 'brain/topics/operations/RUNBOOK.md';
const DOCUMENTS = [SETUP_TABLET, SETUP_ACCOUNTS, RUNBOOK, 'CLAUDE.md', 'brain/MAP.md'];

const read = (path: string) => readFileSync(path, 'utf8');

/** The text of a Markdown section, from its heading to the next heading of the same or a higher level. */
function section(path: string, heading: string): string {
  const lines = read(path).split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return '';
  const level = /^#+/.exec(heading)?.[0].length ?? 1;
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^#+ /.test(line) && (/^#+/.exec(line)?.[0].length ?? 0) <= level,
  );
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

const devices = () => section(SETUP_ACCOUNTS, '### Tablet della cassa (account di dispositivo)');

describe('docs/setup-tablet.md', () => {
  it('exists', () => {
    expect(existsSync(SETUP_TABLET)).toBe(true);
  });

  it('covers install, sign-in, reader and uid format, virtual keyboard and real screen density', () => {
    const text = existsSync(SETUP_TABLET) ? read(SETUP_TABLET) : '';
    for (const step of [
      'Installa app', // PWA from Chrome
      '/accedi',
      '/cassa',
      'LETTORE CARD', // the uid format, admin cashier only
      'Mostra tastiera virtuale',
      'devicePixelRatio',
      '1024',
    ]) {
      expect(text).toContain(step);
    }
  });

  it('recalls the PIN in `private` (not identity’s column) and the /impostazioni/pin route', () => {
    const text = existsSync(SETUP_TABLET) ? read(SETUP_TABLET) : '';
    expect(text).toContain('private.operator_pins');
    expect(text).toContain('SPEC-identity.md');
    expect(text).toContain('/impostazioni/pin');
    expect(text).toContain('contract.md');
  });
});

describe('docs/setup-accounts.md, the device account', () => {
  it('has a section that creates a device with the Supabase screen and the SQL line', () => {
    const text = devices();
    expect(text).toContain('Authentication → Users → Add user → Create new user');
    expect(text).toContain('Auto Confirm User');
    expect(text).toContain('SQL Editor');
    expect(text).toContain("select private.add_device('<email>', '<nome del tablet>');");
  });

  it('removes and relinks a device, and says operator and device exclude each other', () => {
    const text = devices();
    expect(text).toContain('Delete user');
    expect(text).toMatch(/stesso nome/);
    expect(text).toContain('private.add_operator');
    expect(text).toContain('docs/setup-tablet.md');
  });
});

describe('RUNBOOK', () => {
  it('has the till tablet procedure and its traps', () => {
    const text = read(RUNBOOK);
    expect(text).toContain('### Tablet della cassa');
    expect(text).toContain('docs/setup-tablet.md');
    expect(text).toContain('Mostra tastiera virtuale');
    expect(text).toContain('cassa-blocco@example.com');
    expect(text).toContain('e2e/db.ts');
  });
});

describe('CLAUDE.md', () => {
  it('names the Playwright tablet projects and the routes /cassa and /impostazioni/pin', () => {
    const text = read('CLAUDE.md');
    expect(text).toContain('`tablet`');
    expect(text).toContain('`tablet-settings`');
    expect(text).toContain('`/cassa`');
    expect(text).toContain('`/impostazioni/pin`');
    expect(text).toContain('docs/setup-tablet.md');
  });
});

describe('brain/MAP.md', () => {
  it('records the tablet-kiosk module and its documents', () => {
    const row = read('brain/MAP.md')
      .split('\n')
      .find((line) => line.startsWith('| Cassa su tablet (`tablet-kiosk`)'));
    expect(row).toBeDefined();
    expect(row).toContain('src/features/tablet-kiosk/');
    expect(row).toContain('docs/setup-tablet.md');
    expect(read('brain/MAP.md')).toContain('| `docs/setup-tablet.md` |');
    expect(read('brain/MAP.md')).toContain('| `tasks/tablet-kiosk/` |');
  });
});

describe('tablet documents', () => {
  it.each(DOCUMENTS)('%s holds no key or token', (path) => {
    expect(existsSync(path) ? read(path) : '').not.toMatch(
      /sb_secret_|sb_publishable_[A-Za-z0-9]|eyJhbGciOi|service_role_key/i,
    );
  });

  it.each(DOCUMENTS)('%s names only made-up or the bar’s own email addresses', (path) => {
    const emails = (existsSync(path) ? read(path) : '').match(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    expect(emails.filter((email) => !/@(example\.com|enjoygaeta\.it)$/.test(email))).toEqual([]);
  });
});
