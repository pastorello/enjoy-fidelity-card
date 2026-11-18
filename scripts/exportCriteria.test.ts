import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SPEC-export, task 15: every success criterion from 1 to 9 names the tests that prove it, and those
// tests exist; criterion 10 (the phone with the installed PWA and staging) points to its RUNBOOK
// procedure; the project map records the module as done; the module's documents carry no secret and
// no real person's contact.

const PLAN = 'tasks/export/plan.md';
const RUNBOOK = 'brain/topics/operations/RUNBOOK.md';
const MANUAL_SECTION = "### Prova manuale dell'esportazione";
const MANUAL_REFERENCE = "RUNBOOK, «Prova manuale dell'esportazione»";
const SECTION = '## Verifica dei criteri di successo';
const CRITERIA = 10;
const MANUAL = 10;

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
  'docs/specs/SPEC-export.md',
  PLAN,
  'tasks/export/todo.md',
  'brain/MAP.md',
  'brain/STATUS.md',
  RUNBOOK,
];

describe('export success criteria', () => {
  const all = proofs();

  it('the plan lists the 10 criteria in order', () => {
    expect(rows().map((row) => row.criterion)).toEqual(
      Array.from({ length: CRITERIA }, (_, index) => index + 1),
    );
  });

  it('the plan proves each of the criteria 1–9 with at least one test', () => {
    const covered = new Set(all.map((proof) => proof.criterion).filter((c) => c !== MANUAL));
    expect([...covered].toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: CRITERIA - 1 }, (_, index) => index + 1),
    );
  });

  it('every cited test exists in the file it names', () => {
    expect(all.length).toBeGreaterThan(0);
    const missing = all.filter(
      (proof) => !existsSync(proof.file) || !readFileSync(proof.file, 'utf8').includes(proof.title),
    );
    expect(missing).toEqual([]);
  });

  it('criterion 10 points to its RUNBOOK procedure, which exists', () => {
    expect(readFileSync(RUNBOOK, 'utf8')).toContain(MANUAL_SECTION);
    const manual = rows().find((row) => row.criterion === MANUAL);
    expect(manual?.line).toContain(MANUAL_REFERENCE);
  });

  it('the project map records the export module as done', () => {
    const row = readFileSync('brain/MAP.md', 'utf8')
      .split('\n')
      .find((line) => line.startsWith('| Esportazione (`export`)'));
    expect(row).toBeDefined();
    expect(row).toContain('| completo');
  });
});

describe('export documents', () => {
  it.each(DOCUMENTS)('%s holds no key or token', (path) => {
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/sb_secret_|sb_publishable_|eyJhbGciOi|service_role_key/i);
  });

  it.each(DOCUMENTS)('%s names only made-up or the bar’s own email addresses', (path) => {
    const emails = readFileSync(path, 'utf8').match(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    expect(emails.filter((email) => !/@(example\.com|enjoygaeta\.it)$/.test(email))).toEqual([]);
  });
});
