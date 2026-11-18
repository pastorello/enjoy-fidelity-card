import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPORT_ERRCODES } from '../src/features/export/supabaseExportService';

// SPEC-export, "Code Style" and "Boundaries": components never call getSupabase(); only
// supabaseExportService.ts names the export RPCs, and only main.tsx imports it (where it is injected).
// Only downloadFile.ts touches the DOM to save the file. Nothing in the module logs or writes to a
// browser storage: the rows are customers' data and must never be left behind. Every SQLSTATE the
// export migration raises has a translation in the service.

const SRC = 'src';
const MODULE = 'src/features/export/';
const SERVICE = 'src/features/export/supabaseExportService.ts';
const DOWNLOAD = 'src/features/export/downloadFile.ts';
const MAIN = 'src/main.tsx';
const RPCS = ['export_customers', 'export_movements'];
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

/** The code without its comments, string literals kept: a doc comment may name `export_customers`. */
function stripComments(text: string): string {
  return text.replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)/g,
    (match, literal: string | undefined) => literal ?? '',
  );
}

function appFiles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((file) => !file.path.startsWith(TEST_SUPPORT));
}

/** Files that call getSupabase() inside the export module, other than its service. */
export function supabaseOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path.startsWith(MODULE) && file.path !== SERVICE)
    .filter((file) => /\bgetSupabase\b/.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** App files that name an export RPC in their code. */
export function exportRpcAccess(files: readonly SourceFile[]): string[] {
  const access = new RegExp(`['"\`](${RPCS.join('|')})['"\`]`);
  return appFiles(files)
    .filter((file) => access.test(stripComments(file.text)))
    .map((file) => file.path);
}

/** App files that import the Supabase export service, other than main.tsx (where it is injected). */
export function serviceImportOffenders(files: readonly SourceFile[]): string[] {
  const importer = /from\s+['"][^'"]*\/supabaseExportService['"]/;
  return appFiles(files)
    .filter((file) => file.path !== MAIN && importer.test(stripComments(file.text)))
    .map((file) => file.path);
}

const DOM_DOWNLOAD = /\bdocument\s*\??\.|\bURL\s*\??\.\s*(createObjectURL|revokeObjectURL)\b/;

/** Export files, other than downloadFile.ts, that touch `document` or create a download URL. */
export function downloadOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path.startsWith(MODULE) && file.path !== DOWNLOAD)
    .filter((file) => DOM_DOWNLOAD.test(stripComments(file.text)))
    .map((file) => file.path);
}

const MODULE_BANS = [
  { name: 'console', pattern: /\bconsole\s*\??\./ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { name: 'indexedDB', pattern: /\bindexedDB\b/ },
] as const;

/** `path: what` for every export file that logs or writes to a browser storage. */
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

function exportMigrations(): string[] {
  const names = readdirSync(MIGRATIONS).filter((name) => /_export[a-z_]*\.sql$/.test(name));
  if (names.length === 0) throw new Error('export migration not found');
  return names.map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'));
}

const files: SourceFile[] = sourceFiles(SRC).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

describe('export boundary', () => {
  it('finds the application sources', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain(SERVICE);
    expect(paths).toContain('src/features/export/fetchAllPages.ts');
    expect(paths).toContain(MAIN);
  });

  it('keeps getSupabase() in the export service only', () => {
    expect(supabaseOffenders(files)).toEqual([]);
  });

  it('lets only supabaseExportService.ts call the export RPCs', () => {
    expect(exportRpcAccess(files)).toEqual([SERVICE]);
  });

  it('imports the Supabase export service only where it is injected (main.tsx)', () => {
    expect(serviceImportOffenders(files)).toEqual([]);
  });

  it('lets only downloadFile.ts touch document or create a download URL', () => {
    expect(downloadOffenders(files)).toEqual([]);
  });

  it('never logs or writes to a browser storage inside export', () => {
    expect(moduleOffenders(files)).toEqual([]);
  });

  it('translates exactly the SQLSTATEs the export migration raises', () => {
    const raised = raisedErrcodes(exportMigrations());
    expect(raised).toContain('42501');
    expect(Object.keys(EXPORT_ERRCODES).toSorted((a, b) => a.localeCompare(b))).toEqual(raised);
  });
});

describe('export boundary guard (self-test)', () => {
  const component = 'src/features/export/ExportSection.tsx';

  it('fails when a component calls Supabase', () => {
    const rpc = [
      {
        path: component,
        text: "await getSupabase().schema('app').rpc('export_customers', { p_limit: 1000 });",
      },
    ];
    expect(supabaseOffenders(rpc)).toEqual([component]);
    expect(exportRpcAccess(rpc)).toEqual([component]);
  });

  it('fails when a component imports the Supabase service', () => {
    const text = "import { supabaseExportService } from './supabaseExportService';";
    expect(serviceImportOffenders([{ path: component, text }])).toEqual([component]);
  });

  it('fails when a file other than downloadFile.ts creates the download', () => {
    const cases = [
      "const link = document.createElement('a');",
      'const url = URL.createObjectURL(blob);',
      'URL.revokeObjectURL(url);',
    ];
    for (const text of cases) {
      expect(downloadOffenders([{ path: component, text }])).toEqual([component]);
      expect(downloadOffenders([{ path: DOWNLOAD, text }])).toEqual([]);
    }
  });

  it('fails when the module logs or writes to a browser storage', () => {
    const cases = [
      ['console.log(csv);', 'console'],
      ["localStorage.setItem('csv', csv);", 'localStorage'],
      ["window.sessionStorage.setItem('rows', json);", 'sessionStorage'],
      ["indexedDB.open('export');", 'indexedDB'],
    ] as const;
    for (const [text, name] of cases) {
      expect(moduleOffenders([{ path: component, text }])).toEqual([`${component}: ${name}`]);
    }
  });

  it('finds an errcode the service would not translate', () => {
    const sql =
      "raise exception 'x' using errcode = '42501'; raise exception 'y' using errcode = 'EX001';";
    expect(raisedErrcodes([sql])).toEqual(['42501', 'EX001']);
  });

  it('ignores comments that name what they do not call', () => {
    const text =
      "// never console.log, never document.createElement, never getSupabase().rpc('export_movements')\nconst a = 1;";
    const example = [{ path: component, text }];
    expect(supabaseOffenders(example)).toEqual([]);
    expect(exportRpcAccess(example)).toEqual([]);
    expect(downloadOffenders(example)).toEqual([]);
    expect(moduleOffenders(example)).toEqual([]);
  });
});
