import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC-card-input, "Code Style" and "Boundaries": the browser's card APIs (NDEFReader, navigator.vibrate,
// permissions.query, keydown listeners on document) live only in src/features/card-input/; the module
// never logs (uids and URLs carry the customer's token) and never locks a tag (makeReadOnly); the E2E
// fake card (window.__enjoyFakeCard*) lives only in fakeCardAdapter.ts and is loaded only by main.tsx
// behind `import.meta.env.VITE_E2E === '1'`.

const SRC = 'src';
const MODULE = 'src/features/card-input/';
const FAKE_ADAPTER = 'src/features/card-input/fakeCardAdapter.ts';
const MAIN = 'src/main.tsx';
// Test support (fake NDEFReader for the unit tests): never imported by the app, never in a build.
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

/**
 * The code without its comments, string literals kept: doc comments may name `NDEFReader` or explain
 * why `makeReadOnly()` is never called without counting as a use.
 */
export function stripComments(text: string): string {
  return text.replaceAll(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)/g,
    (match, literal: string | undefined) => literal ?? '',
  );
}

const BROWSER_CARD_APIS = [
  { name: 'NDEFReader', pattern: /\bNDEFReader\b/ },
  { name: 'navigator.vibrate', pattern: /\bnavigator\s*\??\.\s*vibrate\b/ },
  { name: 'permissions.query', pattern: /\bpermissions\s*\??\.\s*query\b/ },
  {
    name: 'keydown on document',
    pattern: /\b(document|window)\s*\??\.\s*addEventListener\(\s*['"`]keydown['"`]/,
  },
] as const;

/** `path: api` for every file outside card-input that uses a browser card API. */
export function browserApiOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => !file.path.startsWith(MODULE) && !file.path.startsWith(TEST_SUPPORT))
    .flatMap((file) => {
      const code = stripComments(file.text);
      return BROWSER_CARD_APIS.filter((api) => api.pattern.test(code)).map(
        (api) => `${file.path}: ${api.name}`,
      );
    });
}

/** `path: console` or `path: makeReadOnly` for every card-input file that logs or locks a tag. */
export function moduleOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path.startsWith(MODULE))
    .flatMap((file) => {
      const code = stripComments(file.text);
      return [
        ...(/\bconsole\s*\./.test(code) ? [`${file.path}: console`] : []),
        ...(/\bmakeReadOnly\b/.test(code) ? [`${file.path}: makeReadOnly`] : []),
      ];
    });
}

/** Files other than fakeCardAdapter.ts that name `__enjoyFakeCard` in their code. */
export function fakeGlobalOffenders(files: readonly SourceFile[]): string[] {
  return files
    .filter((file) => file.path !== FAKE_ADAPTER)
    .filter((file) => /__enjoyFakeCard/.test(stripComments(file.text)))
    .map((file) => file.path);
}

/**
 * Files that load the fake adapter, except main.tsx when the import sits inside the
 * `if (import.meta.env.VITE_E2E === '1')` block (the only condition Vite strips from a normal build).
 */
export function fakeImportOffenders(files: readonly SourceFile[]): string[] {
  const loader = /(from\s+|import\(\s*)['"][^'"]*\/fakeCardAdapter['"]/;
  return files
    .filter((file) => loader.test(stripComments(file.text)))
    .filter((file) => file.path !== MAIN || !importedOnlyUnderE2eFlag(stripComments(file.text)))
    .map((file) => file.path);
}

function importedOnlyUnderE2eFlag(code: string): boolean {
  const guard = /if\s*\(\s*import\.meta\.env\.VITE_E2E\s*===\s*['"]1['"]\s*\)\s*\{/.exec(code);
  if (!guard) return false;
  const loaders = [...code.matchAll(/(from\s+|import\(\s*)['"][^'"]*\/fakeCardAdapter['"]/g)];
  const start = guard.index + guard[0].length;
  const end = blockEnd(code, start);
  return loaders.every((match) => match.index > start && match.index < end);
}

/** Index of the `}` that closes the block opened just before `start`. */
function blockEnd(code: string, start: number): number {
  let depth = 1;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') depth -= 1;
    if (depth === 0) return i;
  }
  return code.length;
}

const files: SourceFile[] = sourceFiles(SRC).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

describe('card-input boundary', () => {
  it('finds the application sources', () => {
    const paths = files.map((file) => file.path);
    expect(paths).toContain(FAKE_ADAPTER);
    expect(paths).toContain('src/features/card-input/webNfcAdapter.ts');
    expect(paths).toContain(MAIN);
  });

  it('keeps NDEFReader, navigator.vibrate, permissions.query and document keydown in card-input', () => {
    expect(browserApiOffenders(files)).toEqual([]);
  });

  it('never logs nor calls makeReadOnly inside card-input', () => {
    expect(moduleOffenders(files)).toEqual([]);
  });

  it('names window.__enjoyFakeCard only in fakeCardAdapter.ts', () => {
    expect(fakeGlobalOffenders(files)).toEqual([]);
  });

  it('loads the fake adapter only from main.tsx behind VITE_E2E', () => {
    expect(fakeImportOffenders(files)).toEqual([]);
  });
});

describe('card-input boundary guard (self-test)', () => {
  const component = 'src/features/customers/Example.tsx';
  const moduleFile = 'src/features/card-input/example.ts';

  it('fails when a component outside card-input calls NDEFReader', () => {
    const offenders = browserApiOffenders([
      { path: component, text: 'const reader = new window.NDEFReader();' },
    ]);
    expect(offenders).toEqual([`${component}: NDEFReader`]);
  });

  it('fails on vibrate, permissions.query and keydown on document outside card-input', () => {
    const offenders = browserApiOffenders([
      {
        path: component,
        text: [
          'navigator.vibrate(200);',
          "await navigator.permissions.query({ name: 'nfc' });",
          "document.addEventListener('keydown', onKey);",
        ].join('\n'),
      },
    ]);
    expect(offenders).toEqual([
      `${component}: navigator.vibrate`,
      `${component}: permissions.query`,
      `${component}: keydown on document`,
    ]);
  });

  it('ignores comments and the card-input module itself', () => {
    const offenders = browserApiOffenders([
      { path: component, text: '// the reader wraps NDEFReader\nconst url = "https://x.test/";' },
      { path: moduleFile, text: 'new NDEFReader();' },
    ]);
    expect(offenders).toEqual([]);
  });

  it('fails when a console.log or makeReadOnly appears in card-input', () => {
    const offenders = moduleOffenders([
      { path: moduleFile, text: 'console.log(uid);\nawait reader.makeReadOnly();' },
      { path: component, text: 'console.log(1);' },
    ]);
    expect(offenders).toEqual([`${moduleFile}: console`, `${moduleFile}: makeReadOnly`]);
  });

  it('fails when __enjoyFakeCard is named outside fakeCardAdapter.ts', () => {
    expect(
      fakeGlobalOffenders([
        { path: FAKE_ADAPTER, text: 'host.__enjoyFakeCard = read;' },
        { path: component, text: "window.__enjoyFakeCard?.('04A1');" },
      ]),
    ).toEqual([component]);
  });

  it('fails when the fake adapter is imported outside the VITE_E2E block', () => {
    const inside =
      "if (import.meta.env.VITE_E2E === '1') {\n  await import('./features/card-input/fakeCardAdapter');\n}";
    const outside = "import { createFakeCard } from './features/card-input/fakeCardAdapter';";
    expect(fakeImportOffenders([{ path: MAIN, text: inside }])).toEqual([]);
    expect(fakeImportOffenders([{ path: MAIN, text: outside }])).toEqual([MAIN]);
    expect(
      fakeImportOffenders([{ path: component, text: inside.replace('./', '../card-input/') }]),
    ).toEqual([component]);
  });
});
