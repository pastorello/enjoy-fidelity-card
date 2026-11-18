import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KIOSK_ERRCODES } from '../src/features/tablet-kiosk/supabaseKioskService';

// SPEC-tablet-kiosk, "Code Style" and "Boundaries": components never call getSupabase(); only
// supabaseKioskService.ts names the kiosk RPCs, and only main.tsx imports it (where it is injected).
// The PIN never ends up in a log, a URL or a browser storage: nothing in the module logs, writes to a
// storage or builds a query string. Every SQLSTATE the tablet-kiosk migration raises has a
// translation in the service.

const SRC = 'src';
const MODULE = 'src/features/tablet-kiosk/';
const SERVICE = 'src/features/tablet-kiosk/supabaseKioskService.ts';
const MAIN = 'src/main.tsx';
const RPCS = ['list_cashiers', 'unlock_cashier', 'end_cashier_turn', 'set_my_pin'];
// Test support (fake services): never imported by the app, never in a build.
const TEST_SUPPORT = 'src/test/';
const MIGRATIONS = 'supabase/migrations';

type SourceFile = { path: string; text: string };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [relative('.', path).split('\\').join('/')];
  });
}

/** The code without its comments, string literals kept: a doc comment may name `set_my_pin`. */
function stripComments(text: string): string {
  return text.replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)/g,
    (match, literal: string | undefined) => literal ?? '',
  );
}

function appFiles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((file) => !file.path.startsWith(TEST_SUPPORT));
}

/** Files that call getSupabase() inside the kiosk module, other than its service. */
export function supabaseOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path.startsWith(MODULE) && file.path !== SERVICE)
    .filter((file) => /\bgetSupabase\b/.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** App files that name a kiosk RPC in their code. */
export function kioskRpcAccess(files: readonly SourceFile[]): string[] {
  const access = new RegExp(`['"\`](${RPCS.join('|')})['"\`]`);
  return appFiles(files)
    .filter((file) => access.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** App files that import the Supabase kiosk service, other than main.tsx (where it is injected). */
export function serviceImportOffenders(files: readonly SourceFile[]): string[] {
  const importer = /from\s+['"][^'"]*\/supabaseKioskService['"]/;
  return appFiles(files)
    .filter((file) => file.path !== MAIN && importer.test(stripComments(file.text)))
    .map((file) => file.path);
}

const MODULE_BANS = [
  { name: 'console', pattern: /\bconsole\s*\??\./ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { name: 'indexedDB', pattern: /\bindexedDB\b/ },
  // The module never needs a query string: none can carry a PIN.
  { name: 'query string', pattern: /\bURLSearchParams\b|\bsearchParams\b|[?&]pin=/i },
] as const;

/** `path: what` for every kiosk file that logs, writes to a browser storage or builds a query. */
export function moduleOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path.startsWith(MODULE))
    .flatMap((file) => {
      const code = stripComments(file.text);
      return MODULE_BANS.filter((ban) => ban.pattern.test(code)).map(
        (ban) => `${file.path}: ${ban.name}`,
      );
    });
}

/** Every SQLSTATE the given migration texts raise with `using errcode = '…'`, sorted. */
export function raisedErrcodes(texts: readonly string[]): string[] {
  const codes = texts.flatMap((text) =>
    [...text.matchAll(/errcode\s*=\s*'([0-9A-Z]{5})'/g)].map((match) => match[1] ?? ''),
  );
  return [...new Set(codes)].toSorted((a, b) => a.localeCompare(b));
}

function kioskMigrations(): string[] {
  const names = readdirSync(MIGRATIONS).filter((name) => /_tablet_kiosk[a-z_]*\.sql$/.test(name));
  if (names.length === 0) throw new Error('tablet_kiosk migration not found');
  return names.map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'));
}

const files: SourceFile[] = sourceFiles(SRC).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

describe('kiosk boundary', () => {
  it('finds the application sources', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain(SERVICE);
    expect(paths).toContain('src/features/tablet-kiosk/types.ts');
    expect(paths).toContain(MAIN);
  });

  it('keeps getSupabase() in the kiosk service only', () => {
    expect(supabaseOffenders(files)).toEqual([]);
  });

  it('lets only supabaseKioskService.ts call the kiosk RPCs', () => {
    expect(kioskRpcAccess(files)).toEqual([SERVICE]);
  });

  it('imports the Supabase kiosk service only where it is injected (main.tsx)', () => {
    expect(serviceImportOffenders(files)).toEqual([]);
  });

  it('never logs, writes to a browser storage or builds a query string inside tablet-kiosk', () => {
    expect(moduleOffenders(files)).toEqual([]);
  });

  it('translates exactly the SQLSTATEs the tablet-kiosk migration raises', () => {
    const raised = raisedErrcodes(kioskMigrations());
    expect(raised).toContain('42501');
    expect(raised).toContain('22023');
    expect(Object.keys(KIOSK_ERRCODES).toSorted((a, b) => a.localeCompare(b))).toEqual(raised);
  });
});

describe('kiosk boundary guard (self-test)', () => {
  const component = 'src/features/tablet-kiosk/CashierPage.tsx';

  it('fails when a component calls Supabase', () => {
    const rpc = [
      {
        path: component,
        text: "await getSupabase().schema('app').rpc('unlock_cashier', { p_pin: pin });",
      },
    ];
    expect(supabaseOffenders(rpc)).toEqual([component]);
    expect(kioskRpcAccess(rpc)).toEqual([component]);
  });

  it('fails when a file outside the module names a kiosk RPC', () => {
    const other = 'src/features/identity/SettingsPage.tsx';
    const text = "await client.rpc('set_my_pin', { p_pin: pin });";
    expect(kioskRpcAccess([{ path: other, text }])).toEqual([other]);
  });

  it('fails when a component imports the Supabase service', () => {
    const text = "import { supabaseKioskService } from './supabaseKioskService';";
    expect(serviceImportOffenders([{ path: component, text }])).toEqual([component]);
    expect(serviceImportOffenders([{ path: MAIN, text }])).toEqual([]);
  });

  it('fails when the module logs, writes to a browser storage or puts the PIN in a URL', () => {
    const cases = [
      ['console.log(pin);', 'console'],
      ['console.error(error);', 'console'],
      ["localStorage.setItem('pin', pin);", 'localStorage'],
      ["window.sessionStorage.setItem('pin', pin);", 'sessionStorage'],
      ["indexedDB.open('kiosk');", 'indexedDB'],
      ['navigate(`/cassa?pin=${pin}`);', 'query string'],
      ['const query = new URLSearchParams({ pin });', 'query string'],
    ] as const;
    for (const [text, name] of cases) {
      expect(moduleOffenders([{ path: component, text }])).toEqual([`${component}: ${name}`]);
    }
  });

  it('finds an errcode the service would not translate', () => {
    const sql =
      "raise exception 'x' using errcode = '42501'; raise exception 'y' using errcode = 'EK001';";
    expect(raisedErrcodes([sql])).toEqual(['42501', 'EK001']);
  });

  it('ignores comments that name what they do not call', () => {
    const text =
      "// never console.log(pin), never localStorage, never getSupabase().rpc('unlock_cashier')\nconst a = 1;";
    const example = [{ path: component, text }];
    expect(supabaseOffenders(example)).toEqual([]);
    expect(kioskRpcAccess(example)).toEqual([]);
    expect(moduleOffenders(example)).toEqual([]);
  });
});
