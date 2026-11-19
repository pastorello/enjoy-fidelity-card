import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SPEC-tablet-kiosk, task 27: every success criterion from 1 to 8 names the tests that prove it, and
// those tests exist in the file they name; criterion 8 (CI) names the CI steps and the Playwright
// projects; the module's plan documents carry no secret and no real person's contact.

const PLAN = 'tasks/tablet-kiosk/plan.md';
const SECTION = '## Verifica dei criteri di successo';
const CRITERIA = 8;

type Row = { criterion: number; text: string };
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
    return row ? [{ criterion: Number(row[1]), text: row[2] }] : [];
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

const DOCUMENTS = [PLAN, 'tasks/tablet-kiosk/todo.md', 'brain/STATUS.md', 'brain/HANDOFF.md'];

describe('tablet-kiosk success criteria', () => {
  const all = proofs();

  it('the plan lists the 8 criteria in order', () => {
    expect(rows().map((row) => row.criterion)).toEqual(
      Array.from({ length: CRITERIA }, (_, index) => index + 1),
    );
  });

  it('the plan proves each of the criteria 1–8 with at least one test', () => {
    const covered = new Set(all.map((proof) => proof.criterion));
    expect([...covered].toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: CRITERIA }, (_, index) => index + 1),
    );
  });

  it('every cited test exists in the file it names', () => {
    expect(all.length).toBeGreaterThan(0);
    const missing = all.filter(
      (proof) => !existsSync(proof.file) || !readFileSync(proof.file, 'utf8').includes(proof.title),
    );
    expect(missing).toEqual([]);
  });

  const files = (criterion: number) =>
    all.filter((proof) => proof.criterion === criterion).map((proof) => proof.file);

  it('criterion 1 is proved in pgTAP, criterion 6 and 7 in a tablet E2E', () => {
    expect(files(1).some((file) => file.startsWith('supabase/tests/'))).toBe(true);
    expect(files(6).some((file) => /^e2e\/tablet.*\.spec\.ts$/.test(file))).toBe(true);
    expect(files(7).some((file) => /^e2e\/tablet.*\.spec\.ts$/.test(file))).toBe(true);
  });

  it('criterion 8: CI runs pgTAP, the component tests and the E2E of the phone and tablet projects', () => {
    const steps = all.filter((proof) => proof.criterion === 8).map((p) => `${p.file} › ${p.title}`);
    expect(steps).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml › npm run db:test',
        '.github/workflows/ci.yml › npm test',
        '.github/workflows/ci.yml › npm run e2e',
        "playwright.config.ts › name: 'phone'",
        "playwright.config.ts › name: 'tablet'",
      ]),
    );
  });
});

describe('tablet-kiosk closing documents', () => {
  it.each(DOCUMENTS)('%s holds no key or token', (path) => {
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/sb_secret_|sb_publishable_|eyJhbGciOi|service_role_key/i);
  });

  it.each(DOCUMENTS)('%s names only made-up or the bar’s own email addresses', (path) => {
    const emails = readFileSync(path, 'utf8').match(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    // The commit trailer quoted in todo.md is a no-reply address, nobody's contact.
    const allowed = /@(example\.com|enjoygaeta\.it)$|^noreply@anthropic\.com$/;
    expect(emails.filter((email) => !allowed.test(email))).toEqual([]);
  });
});
