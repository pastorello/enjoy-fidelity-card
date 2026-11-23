import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Task 25 of tasks/operators: the documents say how accounts are made now (invites from the
// Operators screen, `private.add_operator` only for the first admin and as a fallback), how the
// Edge Function is served locally and its template trap, and `contract.md` / `CLAUDE.md` match the
// code (route, new columns of app.operators, the function, the EO codes). Deploy notes stay in the
// spec for the orchestrator. No key, token or real address in any of them.

const SETUP_ACCOUNTS = 'docs/setup-accounts.md';
const RUNBOOK = 'brain/topics/operations/RUNBOOK.md';
const CONTRACT = 'docs/specs/contract.md';
const CROSS_REVIEW = 'docs/specs/cross-review.md';
const MAP = 'brain/MAP.md';
const MIGRATION = 'supabase/migrations/20261122180044_operators.sql';
const DOCUMENTS = [SETUP_ACCOUNTS, RUNBOOK, CONTRACT, 'CLAUDE.md', CROSS_REVIEW, MAP];

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

/** Every EOnnn raised by the operators migration. */
const migrationCodes = () =>
  [
    ...new Set([...read(MIGRATION).matchAll(/errcode = '(EO\d{3})'/g)].map((match) => match[1])),
  ].toSorted();

/** Every column the operators migration adds to app.operators. */
const migrationColumns = () => {
  const block = /alter table app\.operators([\s\S]*?);/.exec(read(MIGRATION))?.[1] ?? '';
  return [...block.matchAll(/add column (\w+)/g)].map((match) => match[1] ?? '');
};

const accounts = () => section(SETUP_ACCOUNTS, '## 4. Operatori e amministratori');

describe('docs/setup-accounts.md §4', () => {
  it('no longer says there are no invites from the app', () => {
    expect(accounts()).not.toMatch(/niente inviti dall'app/);
  });

  it('invites from the exact screen, with every button of the Operators screen', () => {
    const text = accounts();
    for (const step of [
      'Impostazioni → GESTIONE → Operatori',
      '/impostazioni/operatori',
      'Invita operatore',
      'Invia invito',
      'Enjoy Card: il tuo invito',
      '/imposta-password',
      'Salva ruolo',
      'Reinvia invito',
      'Annulla invito',
      'Disattiva',
      'Riattiva',
    ]) {
      expect(text).toContain(step);
    }
  });

  it('keeps add_operator only for the first admin and as a fallback', () => {
    const text = accounts();
    expect(text).toContain('primo amministratore');
    expect(text).toContain('riserva');
    expect(text).toContain("select private.add_operator('<email>', '<nome>', 'admin');");
  });

  it('says an admin is invited, promoted or reactivated from the tablet only with the PIN again, and points to the deploy notes', () => {
    const text = accounts();
    expect(text).toMatch(/dal tablet/i);
    expect(text).toContain('Conferma con il PIN');
    expect(text).not.toContain('si invita dal telefono');
    expect(text).not.toContain('si riattiva dal telefono');
    expect(text).toContain('SPEC-operators.md');
    expect(text).toContain('Note di deploy');
  });

  it('says the invite link lasts 24 hours', () => {
    expect(accounts()).toContain('**24 ore**');
    expect(accounts()).not.toMatch(/un'ora/);
  });

  it('keeps the device account section of tablet-kiosk', () => {
    expect(section(SETUP_ACCOUNTS, '### Tablet della cassa (account di dispositivo)')).not.toBe('');
  });
});

// SPEC-operators Open Questions 7 (2026-11-23): otp_expiry 86400, the invite and the recovery link.
describe('the 24-hour links', () => {
  it('sets otp_expiry to 86400 in the local config', () => {
    expect(read('supabase/config.toml')).toMatch(/^otp_expiry = 86400$/m);
  });

  it('says 24 hours in both email templates, never an hour', () => {
    for (const template of ['supabase/templates/invite.html', 'supabase/templates/recovery.html']) {
      const text = read(template).replace(/\s+/g, ' ');
      expect(text).toContain('il link vale 24 ore e si usa una volta sola.');
      expect(text).not.toContain('un’ora');
    }
  });

  it('asks Email OTP Expiration = 86400 on the hosted projects, in setup-accounts and the RUNBOOK', () => {
    const setup = read(SETUP_ACCOUNTS);
    expect(setup).toContain('Email OTP Expiration');
    expect(setup).toMatch(/Email OTP Expiration\*\*: `86400`/);
    expect(setup).not.toMatch(/\| 3600 secondi/);
    expect(read(RUNBOOK)).toMatch(/Email OTP Expiration[^\n]*86400/);
  });
});

describe('RUNBOOK', () => {
  it('serves the Edge Function locally with its .env', () => {
    const text = read(RUNBOOK);
    expect(text).toContain('npx supabase functions serve');
    expect(text).toContain('cp supabase/functions/.env.example supabase/functions/.env');
  });

  it('has the Kong template trap and its remedy', () => {
    const text = read(RUNBOOK);
    expect(text).toContain('docker restart supabase_kong_enjoy-card-app');
    expect(text).toContain('templatemailer_template_body_http_error');
    expect(text).toContain('status code 404');
  });

  it('points the Operatori procedure to the app screen and names the reserved E2E accounts', () => {
    const text = section(RUNBOOK, '### Operatori');
    expect(text).toContain('/impostazioni/operatori');
    expect(text).toContain('primo amministratore');
    const commands = section(RUNBOOK, '## 1. Comandi');
    for (const email of [
      'admin-operatori@example.com',
      'disattiva@example.com',
      'ruolo@example.com',
      'cassa-operatori@example.com',
    ]) {
      expect(commands).toContain(email);
    }
  });
});

describe('docs/specs/contract.md matches the code', () => {
  it('names the route, the function and the RPCs of the module', () => {
    const text = read(CONTRACT);
    expect(read('src/app/routes.tsx')).toContain("path: 'impostazioni/operatori'");
    expect(text).toContain('`/impostazioni/operatori`');
    expect(text).toContain('supabase/functions/operator-invites');
    for (const rpc of ['app.list_operators', 'app.set_operator_role', 'app.set_operator_active']) {
      expect(read(MIGRATION)).toContain(`create function ${rpc}(`);
      expect(text).toContain(rpc);
    }
  });

  it('lists every column the migration adds to app.operators', () => {
    const columns = migrationColumns();
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) expect(read(CONTRACT)).toContain(column);
  });

  it('lists exactly the EO codes the migration raises', () => {
    const codes = migrationCodes();
    expect(codes).toEqual(['EO001', 'EO002', 'EO003', 'EO004', 'EO005']);
    const documented = [...new Set(read(CONTRACT).match(/EO\d{3}/g) ?? [])].toSorted();
    expect(documented).toEqual(codes);
  });
});

describe('CLAUDE.md matches the code', () => {
  it('says accounts come from the Operators screen and add_operator stays for the first admin', () => {
    const text = section('CLAUDE.md', '## Ruoli');
    expect(text).not.toMatch(/niente inviti dall'app/);
    expect(text).toContain('/impostazioni/operatori');
    expect(text).toContain('primo amministratore');
    expect(text).toContain('supabase/functions/operator-invites');
    expect(text).toMatch(/dal tablet/i);
  });

  it('has the command that serves the Edge Function', () => {
    expect(section('CLAUDE.md', '## Comandi')).toContain('npx supabase functions serve');
  });
});

describe('docs/specs/cross-review.md', () => {
  it('puts the Operatori row first in GESTIONE and gives the tablet Operatori layout to operators', () => {
    const text = read(CROSS_REVIEW);
    expect(text).toContain('4. GESTIONE (solo admin): riga Operatori di `operators`');
    expect(text).toContain('OperatorsSettingsRow');
    expect(text).toMatch(/"Tablet: operatori"[^\n]*`operators`/);
  });
});

describe('brain/MAP.md', () => {
  it('records the operators module and its documents', () => {
    const map = read(MAP);
    const row = map.split('\n').find((line) => line.startsWith('| Operatori (`operators`)'));
    expect(row).toBeDefined();
    expect(row).toContain('src/features/operators/');
    expect(row).toContain('supabase/functions/operator-invites/');
    expect(row).toContain('scripts/operatorsBoundary.test.ts');
    expect(map).toContain('| `tasks/operators/` |');
    expect(map).toContain('| `supabase/templates/invite.html` |');
  });
});

describe('operators documents', () => {
  it.each(DOCUMENTS)('%s holds no key or token', (path) => {
    expect(read(path)).not.toMatch(
      /sb_secret_[A-Za-z0-9]|sb_publishable_[A-Za-z0-9]|eyJhbGciOi|service_role_key/i,
    );
  });

  it.each(DOCUMENTS)('%s names only made-up or the bar’s own email addresses', (path) => {
    const emails = read(path).match(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    expect(emails.filter((email) => !/@(example\.com|enjoygaeta\.it)$/.test(email))).toEqual([]);
  });
});
