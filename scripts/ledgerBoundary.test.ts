import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC-ledger, "Code Style" and "Boundaries": components use LedgerService through
// useLedgerService(), never getSupabase(); only supabaseLedgerService.ts reads the movement_history
// view, app.movements or calls the ledger RPCs. The operation_id lives only in memory (Open
// Question 8): nothing in the module logs or writes to a browser storage, so a reload never resends.

const SRC = 'src';
const MODULE = 'src/features/ledger/';
const SERVICE = 'src/features/ledger/supabaseLedgerService.ts';
const MAIN = 'src/main.tsx';
const RPCS = ['record_purchase', 'redeem_reward', 'redeem_free_reward', 'cancel_movement'];
const TABLES = ['movement_history', 'movements'];
// Test support (fake services): never imported by the app, never in a build.
const TEST_SUPPORT = 'src/test/';

type SourceFile = { path: string; text: string };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [relative('.', path).split('\\').join('/')];
  });
}

/** The code without its comments, string literals kept: a doc comment may name `cancel_movement`. */
function stripComments(text: string): string {
  return text.replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)/g,
    (match, literal: string | undefined) => literal ?? '',
  );
}

function appFiles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((file) => !file.path.startsWith(TEST_SUPPORT));
}

/** Files that call getSupabase() inside the ledger module, other than its service. */
export function supabaseOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path.startsWith(MODULE) && file.path !== SERVICE)
    .filter((file) => /\bgetSupabase\b/.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** Files that read movement_history or app.movements, or name a ledger RPC, in their code. */
export function ledgerAccess(files: readonly SourceFile[]): string[] {
  const access = new RegExp(
    `\\.from\\(\\s*['"\`](${TABLES.join('|')})['"\`]|['"\`](${RPCS.join('|')})['"\`]`,
  );
  return appFiles(files)
    .filter((file) => access.test(stripComments(file.text)))
    .map((file) => file.path);
}

/**
 * App files that import the Supabase ledger service, other than main.tsx (where it is injected).
 * The fake in src/test/ shares its REQUEST_TIMEOUT_MS and is never part of a build.
 */
export function serviceImportOffenders(files: readonly SourceFile[]): string[] {
  const importer = /from\s+['"][^'"]*\/supabaseLedgerService['"]/;
  return appFiles(files)
    .filter((file) => file.path !== MAIN && importer.test(stripComments(file.text)))
    .map((file) => file.path);
}

const MODULE_BANS = [
  { name: 'console', pattern: /\bconsole\s*\??\./ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { name: 'indexedDB', pattern: /\bindexedDB\b/ },
  { name: 'document.cookie', pattern: /\bdocument\s*\??\.\s*cookie\b/ },
] as const;

/** `path: what` for every ledger file that logs or writes to a browser storage. */
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

const files: SourceFile[] = sourceFiles(SRC).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

describe('ledger boundary', () => {
  it('finds the application sources', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain(SERVICE);
    expect(paths).toContain('src/features/ledger/useOperation.ts');
    expect(paths).toContain('src/features/ledger/PurchasePage.tsx');
  });

  it('keeps getSupabase() in the ledger service only', () => {
    expect(supabaseOffenders(files)).toEqual([]);
  });

  it('lets only supabaseLedgerService.ts read the movements or call the ledger RPCs', () => {
    expect(ledgerAccess(files)).toEqual([SERVICE]);
  });

  it('imports the Supabase ledger service only where it is injected (main.tsx)', () => {
    expect(serviceImportOffenders(files)).toEqual([]);
  });

  it('never logs or writes to a browser storage inside ledger', () => {
    expect(moduleOffenders(files)).toEqual([]);
  });
});

describe('ledger boundary guard (self-test)', () => {
  const component = 'src/features/ledger/Example.tsx';

  it('fails when a component calls Supabase', () => {
    const rpc = [
      {
        path: component,
        text: "await getSupabase().schema('app').rpc('record_purchase', { p_amount_cents: 1250 });",
      },
    ];
    expect(supabaseOffenders(rpc)).toEqual([component]);
    expect(ledgerAccess(rpc)).toEqual([component]);
    const view = [{ path: component, text: "client.from('movement_history').select('*');" }];
    expect(ledgerAccess(view)).toEqual([component]);
  });

  it('fails when a component imports the Supabase service', () => {
    const text = "import { supabaseLedgerService } from './supabaseLedgerService';";
    expect(serviceImportOffenders([{ path: component, text }])).toEqual([component]);
  });

  it('fails when the operation_id is written to a storage or logged', () => {
    const cases = [
      ["localStorage.setItem('op', operationId);", 'localStorage'],
      ["window.sessionStorage.setItem('op', id);", 'sessionStorage'],
      ["indexedDB.open('ops');", 'indexedDB'],
      ['document.cookie = `op=${id}`;', 'document.cookie'],
      ['console.info(operationId);', 'console'],
    ] as const;
    for (const [text, name] of cases) {
      expect(moduleOffenders([{ path: component, text }])).toEqual([`${component}: ${name}`]);
    }
  });

  it('ignores comments that name what they do not call', () => {
    const text =
      "// never localStorage, never console.log, never getSupabase().rpc('cancel_movement')\nconst a = 1;";
    const example = [{ path: component, text }];
    expect(supabaseOffenders(example)).toEqual([]);
    expect(ledgerAccess(example)).toEqual([]);
    expect(moduleOffenders(example)).toEqual([]);
  });
});
