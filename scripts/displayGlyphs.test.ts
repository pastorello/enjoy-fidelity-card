import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Enjoy Display (titles, labels, figures) lacks these characters: the browser draws them in
// Texturina, a visible mismatch. Checked in the browser against the font file; ". , : ; ! ? · •
// + - – — ’ € % &", digits and accented vowels are covered.
const MISSING = /[…«»@#*×→]/;

/** Components whose text is set in Enjoy Display, and the props of theirs that are. */
const DISPLAY_CHILDREN = ['Button', 'ScreenTitle'];
const DISPLAY_PROPS: Record<string, string[]> = {
  AppShell: ['title'],
  StatusView: ['title', 'retryLabel'],
  ConfirmDialog: ['title', 'confirmLabel', 'cancelLabel'],
  CardReadPanel: ['title'],
  CardReadPanelView: ['title'],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.tsx') || entry.name.endsWith('.test.tsx')) return [];
    return [relative('.', path).split('\\').join('/')];
  });
}

/** The JSX tag a position sits in: the last `<Name` opened before it. */
function enclosingTag(text: string, index: number): string | undefined {
  const opened = [...text.slice(0, index).matchAll(/<([A-Z]\w*)/g)];
  return opened.at(-1)?.[1];
}

/** Every literal string set in Enjoy Display in one source file. */
function displayStrings(text: string): string[] {
  const found: string[] = [];
  for (const name of DISPLAY_CHILDREN) {
    for (const match of text.matchAll(
      new RegExp(`<${name}\\b(?:[^>{]|\\{[^}]*\\})*>([\\s\\S]*?)</${name}>`, 'g'),
    )) {
      found.push(match[1] ?? '');
    }
  }
  const prop = /\b(\w+)=(?:"([^"]*)"|\{\s*(['`])([^'`]*)\3\s*\})/g;
  for (const match of text.matchAll(prop)) {
    const tag = enclosingTag(text, match.index);
    const name = match[1] ?? '';
    if (tag && DISPLAY_PROPS[tag]?.includes(name)) found.push(match[2] ?? match[4] ?? '');
  }
  return found;
}

describe('Enjoy Display glyph coverage', () => {
  it('finds display text in the sources', () => {
    const all = sourceFiles('src').flatMap((path) => displayStrings(readFileSync(path, 'utf8')));
    expect(all).toContain('Password dimenticata');
  });

  it('catches a missing glyph in a button and in a title prop', () => {
    expect(displayStrings('<Button onClick={() => go()}>Annulla la spesa…</Button>')).toEqual([
      'Annulla la spesa…',
    ]);
    expect(displayStrings('<StatusView kind="empty" title="Nessun #1" />')).toEqual(['Nessun #1']);
    expect(displayStrings('<ListRow title="a → b" />')).toEqual([]);
    expect(displayStrings('<CardReadPanel title="Avvicina la card…" description="x" />')).toEqual([
      'Avvicina la card…',
    ]);
  });

  it('uses only characters Enjoy Display has in display text', () => {
    const offenders = sourceFiles('src').flatMap((path) =>
      displayStrings(readFileSync(path, 'utf8'))
        .filter((value) => MISSING.test(value))
        .map((value) => `${path}: ${value.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});
