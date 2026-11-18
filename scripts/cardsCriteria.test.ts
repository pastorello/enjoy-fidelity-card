import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SPEC-cards, task 24: every success criterion names the tests that prove it, and those tests exist;
// the manual parts (criteria 10 and 14) point to the RUNBOOK; the project map records the module as
// done; the module's documents carry no secret and no real person's contact.

const PLAN = 'tasks/cards/plan.md';
const RUNBOOK = 'brain/topics/operations/RUNBOOK.md';
const MANUAL_SECTION = '### Prova manuale del link ai punti';
const SECTION = '## Verifica dei criteri di successo';
const CRITERIA = 15;
const MANUAL = [10, 14];

type Row = { criterion: number; text: string; line: string };
type Proof = { criterion: number; file: string; title: string };

function rows(): Row[] {
  const plan = readFileSync(PLAN, 'utf8');
  const start = plan.indexOf(SECTION);
  if (start < 0) return [];
  const body = plan.slice(start + SECTION.length);
  const end = body.search(/\n## /);
  const section = end < 0 ? body : body.slice(0, end);
  return section.split('\n').flatMap((line) => {
    const row = /^\|\s*(\d+)\.[^|]*\|(.*)\|\s*$/.exec(line);
    return row ? [{ criterion: Number(row[1]), text: row[2], line }] : [];
  });
}

function proofs(): Proof[] {
  // A proof is written as `path › test title` (the title as it appears in the file).
  return rows().flatMap(({ criterion, text }) =>
    [...text.matchAll(/`([^`›]+?) › ([^`]+)`/g)].map((match) => ({
      criterion,
      file: match[1].trim(),
      title: match[2].trim(),
    })),
  );
}

const DOCUMENTS = [
  'docs/specs/SPEC-cards.md',
  'docs/specs/customer-balance.md',
  PLAN,
  'tasks/cards/todo.md',
  'brain/MAP.md',
  'brain/STATUS.md',
  RUNBOOK,
];

describe('cards success criteria', () => {
  const all = proofs();

  it('the plan proves each of the 15 criteria with at least one test', () => {
    const covered = new Set(all.map((proof) => proof.criterion));
    expect([...covered].toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: CRITERIA }, (_, index) => index + 1),
    );
  });

  it('every cited test exists in the file it names', () => {
    const missing = all.filter(
      (proof) => !existsSync(proof.file) || !readFileSync(proof.file, 'utf8').includes(proof.title),
    );
    expect(missing).toEqual([]);
  });

  it('the manual parts of criteria 10 and 14 point to their RUNBOOK section, which exists', () => {
    const runbook = readFileSync(RUNBOOK, 'utf8');
    expect(runbook).toContain(MANUAL_SECTION);
    const manual = rows().filter((row) => MANUAL.includes(row.criterion));
    expect(manual.map((row) => row.criterion)).toEqual(MANUAL);
    for (const row of manual)
      expect(row.line).toContain('RUNBOOK, «Prova manuale del link ai punti»');
  });

  it('the project map records the cards module as done', () => {
    const row = readFileSync('brain/MAP.md', 'utf8')
      .split('\n')
      .find((line) => line.startsWith('| Card (`cards`)'));
    expect(row).toBeDefined();
    expect(row).toContain('| completo');
  });
});

describe('cards documents', () => {
  it.each(DOCUMENTS)('%s holds no key or token', (path) => {
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/sb_secret_|sb_publishable_|eyJhbGciOi|service_role_key/i);
  });

  it.each(DOCUMENTS)('%s names only made-up or the bar’s own email addresses', (path) => {
    const emails = readFileSync(path, 'utf8').match(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    expect(emails.filter((email) => !/@(example\.com|enjoygaeta\.it)$/.test(email))).toEqual([]);
  });
});
