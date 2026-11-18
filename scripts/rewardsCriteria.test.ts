import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SPEC-rewards, task 14: every success criterion names the tests that prove it, and those tests
// exist; the module's documents carry no secret and no real person's contact.

const PLAN = 'tasks/rewards/plan.md';
const SECTION = '## Verifica dei criteri di successo';
const CRITERIA = 9;

type Proof = { criterion: number; file: string; title: string };

function proofs(): Proof[] {
  const plan = readFileSync(PLAN, 'utf8');
  const start = plan.indexOf(SECTION);
  if (start < 0) return [];
  const body = plan.slice(start + SECTION.length);
  const end = body.search(/\n## /);
  const section = end < 0 ? body : body.slice(0, end);
  return section.split('\n').flatMap((line) => {
    const row = /^\|\s*(\d+)\.[^|]*\|(.*)\|\s*$/.exec(line);
    if (!row) return [];
    const criterion = Number(row[1]);
    // A proof is written as `path › test title` (the title as it appears in the file).
    return [...row[2].matchAll(/`([^`›]+?) › ([^`]+)`/g)].map((match) => ({
      criterion,
      file: match[1].trim(),
      title: match[2].trim(),
    }));
  });
}

const DOCUMENTS = [
  'docs/specs/SPEC-rewards.md',
  PLAN,
  'tasks/rewards/todo.md',
  'brain/MAP.md',
  'brain/STATUS.md',
  'brain/topics/operations/RUNBOOK.md',
];

describe('rewards success criteria', () => {
  const all = proofs();

  it('the plan proves each of the 9 criteria with at least one test', () => {
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
});

describe('rewards documents', () => {
  it.each(DOCUMENTS)('%s holds no key or token', (path) => {
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/sb_secret_|sb_publishable_|eyJhbGciOi|service_role_key/i);
  });

  it.each(DOCUMENTS)('%s names only made-up or the bar’s own email addresses', (path) => {
    const emails = readFileSync(path, 'utf8').match(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    expect(emails.filter((email) => !/@(example\.com|enjoygaeta\.it)$/.test(email))).toEqual([]);
  });
});
