import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Enjoy Display (titles, labels, figures) lacks these characters: the browser draws them in
// Texturina, a visible mismatch. Checked in the browser against the font file; ". , : ; ! ? · •
// + - – — ’ € % &", digits and accented vowels are covered.
const MISSING = /[…«»@#*×→]/;

/** Components whose text is set in Enjoy Display, and the props of theirs that are. */
const DISPLAY_CHILDREN = ['Button', 'ButtonLink', 'ScreenTitle'];
const DISPLAY_PROPS: Record<string, string[]> = {
  AppShell: ['title'],
  StatusView: ['title', 'retryLabel'],
  ConfirmDialog: ['title', 'confirmLabel', 'cancelLabel'],
  CardReadPanel: ['title'],
  CardReadPanelView: ['title'],
  CardLinkScreen: ['title'],
  LedgerDoneView: ['title', 'cancelLabel', 'cancelledTitle'],
  LedgerFailure: ['title'],
};

/**
 * Titles kept out of the JSX: `const …TITLE = '…'` constants (screen and panel titles) and the
 * `title: '…'` of notice and status objects (CardReadNotice, failure texts, StatusView errors).
 */
const TITLE_CONSTANT = /\bconst\s+\w*TITLE\s*=\s*(['`"])([^'`"]*)\1/g;
const TITLE_KEY = /[{,]\s*title:\s*(['`"])([^'`"]*)\1/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
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
      // A JSX comment inside the button (`{/* … */}`) is not drawn.
      found.push((match[1] ?? '').replaceAll(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ''));
    }
  }
  const prop = /\b(\w+)=(?:"([^"]*)"|\{\s*(['`])([^'`]*)\3\s*\})/g;
  for (const match of text.matchAll(prop)) {
    const tag = enclosingTag(text, match.index);
    const name = match[1] ?? '';
    if (tag && DISPLAY_PROPS[tag]?.includes(name)) found.push(match[2] ?? match[4] ?? '');
  }
  for (const match of [...text.matchAll(TITLE_CONSTANT), ...text.matchAll(TITLE_KEY)]) {
    found.push(match[2] ?? '');
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

  it('catches a missing glyph in the cards screens, title constants and notice titles', () => {
    expect(displayStrings('<CardLinkScreen title="Associa → card" backTo="/" />')).toEqual([
      'Associa → card',
    ]);
    expect(displayStrings("const WRITING_TITLE = 'Tieni la card…';")).toEqual(['Tieni la card…']);
    expect(displayStrings("return { title: 'Card #2', text: 'x' };")).toEqual(['Card #2']);
    expect(displayStrings("const subtitle = 'a → b';")).toEqual([]);
  });

  it('catches a missing glyph in the ledger screens', () => {
    expect(
      displayStrings(
        '<LedgerDoneView title="Spesa #1" cancelLabel="Annulla…" cancelledTitle="Spesa → annullata" />',
      ),
    ).toEqual(['Spesa #1', 'Annulla…', 'Spesa → annullata']);
    expect(displayStrings('<LedgerFailure title="Spesa non salvata…" text="x" />')).toEqual([
      'Spesa non salvata…',
    ]);
    expect(
      displayStrings('<ButtonLink to="/x">{/* not drawn: a * b */}Apri la scheda</ButtonLink>'),
    ).toEqual(['Apri la scheda']);
    expect(
      displayStrings('<ButtonLink to="/" replace block>Leggi un’altra card…</ButtonLink>'),
    ).toEqual(['Leggi un’altra card…']);
  });

  it('reads the ledger titles, buttons and failure titles', () => {
    const ledger = sourceFiles('src/features/ledger').flatMap((path) =>
      displayStrings(readFileSync(path, 'utf8')),
    );
    expect(ledger).toEqual(
      expect.arrayContaining([
        'Registra spesa',
        'Spesa registrata',
        'Spesa annullata',
        'Annulla la spesa',
        'Spesa non salvata',
        'Riscatta premio',
        'Premio libero',
        'Premio riscattato',
        'Riscatto annullato',
        'Annulla il riscatto',
        'Riscatto non salvato',
      ]),
    );
  });

  // ESPORTA DATI: only the two buttons are in Enjoy Display (the section title is in the condensed
  // caps, the live region in the body font), so the Button rule already covers them.
  it('reads the export buttons', () => {
    const exportTexts = sourceFiles('src/features/export').flatMap((path) =>
      displayStrings(readFileSync(path, 'utf8')).map((value) => value.trim()),
    );
    expect(exportTexts).toEqual(expect.arrayContaining(['Clienti CSV', 'Movimenti CSV']));
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
