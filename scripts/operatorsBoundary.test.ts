import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATORS_ERRCODES } from '../src/features/operators/supabaseOperatorsService';

// SPEC-operators, "Code Style" and "Boundaries": pages never call getSupabase(); only
// supabaseOperatorsService.ts names the operators RPCs and the operator-invites function, and only
// main.tsx imports it (where it is injected). Nothing in the module logs, writes to a browser
// storage or puts an email in a URL. The secret key stays in the Edge Function: no file of src/
// (tests included) names service_role, SUPABASE_SECRET_KEYS or auth.admin, and the steps of the
// function that only service_role may run are never named by the app.

const SRC = 'src';
const MODULE = 'src/features/operators/';
const SERVICE = 'src/features/operators/supabaseOperatorsService.ts';
const MAIN = 'src/main.tsx';
const RPCS = [
  'list_operators',
  'set_operator_role',
  'set_operator_active',
  // With the cashier's PIN, on the till tablet (Open Questions 11).
  'set_operator_role_with_pin',
  'set_operator_active_with_pin',
];
const FUNCTION = 'operator-invites';
/** Called by the function only (the caller's token or the secret key), never by the app. */
const FUNCTION_RPCS = [
  'operator_invite_begin',
  'operator_invite_finish',
  'operator_invite_fail',
  'operator_invite_orphan',
  'operator_resend_begin',
  'operator_resend_finish',
  'operator_cancel_begin',
  'operator_cancel_check',
];
// Test support (fake services): never imported by the app, never in a build.
const TEST_SUPPORT = 'src/test/';
const MIGRATIONS = 'supabase/migrations';
/**
 * Raised by the migration but never reaching the app: 55000 only by `operator_invite_finish`,
 * which only service_role (the function) may run.
 */
const FUNCTION_ONLY_ERRCODES = new Set(['55000']);

type SourceFile = { path: string; text: string };

function sourceFiles(dir: string, withTests: boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, withTests);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (!withTests && /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [relative('.', path).split('\\').join('/')];
  });
}

/** The code without its comments, string literals kept: a doc comment may name `list_operators`. */
function stripComments(text: string): string {
  return text.replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)/g,
    (match, literal: string | undefined) => literal ?? '',
  );
}

function appFiles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((file) => !file.path.startsWith(TEST_SUPPORT));
}

/** Files that call getSupabase() inside the operators module, other than its service. */
export function supabaseOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path.startsWith(MODULE) && file.path !== SERVICE)
    .filter((file) => /\bgetSupabase\b/.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** App files that name an operators RPC or the operator-invites function in their code. */
export function operatorsAccess(files: readonly SourceFile[]): string[] {
  const names = [...RPCS, FUNCTION].join('|');
  const access = new RegExp(`['"\`](${names})['"\`]`);
  return appFiles(files)
    .filter((file) => access.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** App files that name a step only the function runs, comments included. */
export function functionStepAccess(files: readonly SourceFile[]): string[] {
  const access = new RegExp(`\\b(${FUNCTION_RPCS.join('|')})\\b`);
  return appFiles(files)
    .filter((file) => access.test(file.text))
    .map((file) => file.path);
}

/** App files that import the Supabase operators service, other than main.tsx. */
export function serviceImportOffenders(files: readonly SourceFile[]): string[] {
  const importer = /from\s+['"][^'"]*\/supabaseOperatorsService['"]/;
  return appFiles(files)
    .filter((file) => file.path !== MAIN && importer.test(stripComments(file.text)))
    .map((file) => file.path);
}

const MODULE_BANS = [
  { name: 'console', pattern: /\bconsole\s*\??\./ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { name: 'indexedDB', pattern: /\bindexedDB\b/ },
  // The module never needs a query string: none can carry an email.
  { name: 'query string', pattern: /\bURLSearchParams\b|\bsearchParams\b|[?&]email=/i },
] as const;

/** `path: what` for every operators file that logs, writes to a storage or builds a query. */
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

const SECRET_NAMES = [
  { name: 'service_role', pattern: /service_role/ },
  { name: 'SUPABASE_SECRET_KEYS', pattern: /SUPABASE_SECRET_KEYS/ },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', pattern: /SUPABASE_SERVICE_ROLE_KEY/ },
  { name: 'auth.admin', pattern: /\bauth\s*\.\s*admin\b/ },
] as const;

/** `path: what` for every file of src/ (tests and comments included) naming the secret key's world. */
export function secretOffenders(files: readonly SourceFile[]): string[] {
  return files.flatMap((file) =>
    SECRET_NAMES.filter((secret) => secret.pattern.test(file.text)).map(
      (secret) => `${file.path}: ${secret.name}`,
    ),
  );
}

/** Every SQLSTATE the given migration texts raise with `using errcode = '…'`, sorted. */
export function raisedErrcodes(texts: readonly string[]): string[] {
  const codes = texts.flatMap((text) =>
    [...text.matchAll(/errcode\s*=\s*'([0-9A-Z]{5})'/g)].map((match) => match[1] ?? ''),
  );
  return [...new Set(codes)].toSorted((a, b) => a.localeCompare(b));
}

function operatorsMigrations(): string[] {
  const names = readdirSync(MIGRATIONS).filter((name) => /_operators[a-z_]*\.sql$/.test(name));
  if (names.length === 0) throw new Error('operators migration not found');
  return names.map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'));
}

const read = (path: string): SourceFile => ({ path, text: readFileSync(path, 'utf8') });
const files: SourceFile[] = sourceFiles(SRC, false).map(read);
const everyFile: SourceFile[] = sourceFiles(SRC, true).map(read);

describe('operators boundary', () => {
  it('finds the application sources', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain(SERVICE);
    expect(paths).toContain('src/features/operators/types.ts');
    expect(paths).toContain(MAIN);
  });

  it('keeps getSupabase() in the operators service only', () => {
    expect(supabaseOffenders(files)).toEqual([]);
  });

  it('lets only supabaseOperatorsService.ts call the operators RPCs and operator-invites', () => {
    expect(operatorsAccess(files)).toEqual([SERVICE]);
  });

  it('never names in the app a step that only the Edge Function runs', () => {
    expect(functionStepAccess(files)).toEqual([]);
  });

  it('imports the Supabase operators service only where it is injected (main.tsx)', () => {
    expect(serviceImportOffenders(files)).toEqual([]);
  });

  it('never logs, writes to a browser storage or puts an email in a URL inside operators', () => {
    expect(moduleOffenders(files)).toEqual([]);
  });

  it('never names service_role, the secret keys or auth.admin anywhere in src/', () => {
    expect(everyFile.length).toBeGreaterThan(files.length);
    expect(secretOffenders(everyFile)).toEqual([]);
  });

  it('translates every SQLSTATE the operators migration raises towards the app', () => {
    const raised = raisedErrcodes(operatorsMigrations()).filter(
      (code) => !FUNCTION_ONLY_ERRCODES.has(code),
    );
    for (const code of ['42501', '22023', 'P0002', 'EO001', 'EO005']) {
      expect(raised).toContain(code);
    }
    expect(Object.keys(OPERATORS_ERRCODES).toSorted((a, b) => a.localeCompare(b))).toEqual(raised);
  });
});

describe('operators boundary guard (self-test)', () => {
  const page = 'src/features/operators/OperatorsPage.tsx';

  it('fails when a page calls Supabase or the function', () => {
    const cases = [
      "await getSupabase().schema('app').rpc('set_operator_active', { p_active: false });",
      "await getSupabase().functions.invoke('operator-invites', { body });",
    ];
    for (const text of cases) {
      const example = [{ path: page, text }];
      expect(supabaseOffenders(example)).toEqual([page]);
      expect(operatorsAccess(example)).toEqual([page]);
    }
  });

  it('fails when a file outside the module names an operators RPC or a function step', () => {
    const other = 'src/features/rewards/RewardsSettingsSection.tsx';
    expect(operatorsAccess([{ path: other, text: "client.rpc('list_operators');" }])).toEqual([
      other,
    ]);
    const step = "client.rpc('operator_invite_finish', args);";
    expect(functionStepAccess([{ path: other, text: step }])).toEqual([other]);
  });

  it('fails when a page imports the Supabase service', () => {
    const text = "import { supabaseOperatorsService } from './supabaseOperatorsService';";
    expect(serviceImportOffenders([{ path: page, text }])).toEqual([page]);
    expect(serviceImportOffenders([{ path: MAIN, text }])).toEqual([]);
  });

  it('fails when the module logs, writes to a browser storage or puts an email in a URL', () => {
    const cases = [
      ['console.log(email);', 'console'],
      ['console.warn(error);', 'console'],
      ["localStorage.setItem('email', email);", 'localStorage'],
      ["window.sessionStorage.setItem('draft', name);", 'sessionStorage'],
      ["indexedDB.open('operators');", 'indexedDB'],
      ['navigate(`/impostazioni/operatori?email=${email}`);', 'query string'],
      ['const query = new URLSearchParams({ email });', 'query string'],
    ] as const;
    for (const [text, name] of cases) {
      expect(moduleOffenders([{ path: page, text }])).toEqual([`${page}: ${name}`]);
    }
  });

  it('fails when a file of src/ names the secret key, even in a comment or a test', () => {
    const test = 'src/features/operators/OperatorsPage.test.tsx';
    const cases = [
      ['// uses the service_role key', 'service_role'],
      ['const key = env.SUPABASE_SECRET_KEYS;', 'SUPABASE_SECRET_KEYS'],
      ['const key = env.SUPABASE_SERVICE_ROLE_KEY;', 'SUPABASE_SERVICE_ROLE_KEY'],
      ['await client.auth.admin.deleteUser(id);', 'auth.admin'],
    ] as const;
    for (const [text, name] of cases) {
      expect(secretOffenders([{ path: test, text }])).toEqual([`${test}: ${name}`]);
    }
  });

  it('finds an errcode the service would not translate', () => {
    const sql =
      "raise exception 'x' using errcode = '42501'; raise exception 'y' using errcode = 'EO009';";
    expect(raisedErrcodes([sql])).toEqual(['42501', 'EO009']);
  });

  it('ignores comments that name what they do not call', () => {
    const text =
      "// never console.log(email), never localStorage, never getSupabase().rpc('list_operators')\nconst a = 1;";
    const example = [{ path: page, text }];
    expect(supabaseOffenders(example)).toEqual([]);
    expect(operatorsAccess(example)).toEqual([]);
    expect(moduleOffenders(example)).toEqual([]);
  });
});
