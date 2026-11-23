import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// SPEC-customers-v2, task 37: every success criterion from 1 to 13 names the tests that prove it, and
// those tests exist in the file they name; the criteria that the spec ties to a kind of proof (pgTAP,
// integration, tablet E2E, CI) are proved there; the closing documents carry no secret and no real
// person's contact.

const PLAN = 'tasks/customers-v2/plan.md';
const SECTION = '## Verifica dei criteri di successo';
const CRITERIA = 13;

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

const DOCUMENTS = [PLAN, 'tasks/customers-v2/todo.md', 'brain/STATUS.md', 'brain/HANDOFF.md'];
const ALL_CRITERIA = Array.from({ length: CRITERIA }, (_, index) => index + 1);

describe('customers-v2 success criteria', () => {
  const all = proofs();

  it('the plan lists the 13 criteria in order', () => {
    expect(rows().map((row) => row.criterion)).toEqual(ALL_CRITERIA);
  });

  it('the plan proves each of the criteria 1–13 with at least one test', () => {
    const covered = new Set(all.map((proof) => proof.criterion));
    expect([...covered].toSorted((a, b) => a - b)).toEqual(ALL_CRITERIA);
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
  const cited = (criterion: number) =>
    all.filter((proof) => proof.criterion === criterion).map((p) => `${p.file} › ${p.title}`);

  it('criterion 1: the schema in pgTAP and the boundary test without phone', () => {
    expect(files(1)).toEqual(
      expect.arrayContaining([
        'supabase/tests/customers_v2.test.sql',
        'scripts/customersBoundary.test.ts',
      ]),
    );
  });

  it('criterion 6: the explain assertion of list_customers in pgTAP', () => {
    expect(files(6)).toContain('supabase/tests/customers_v2_plan.test.sql');
  });

  it('criterion 7: the anon allowlist and the rewards of every invalid token in pgTAP, over HTTP too', () => {
    expect(files(7)).toEqual(
      expect.arrayContaining([
        'supabase/tests/card_points.test.sql',
        'supabase/tests/function_privileges.test.sql',
        'tests/integration/customers-v2.test.ts',
      ]),
    );
  });

  it('criterion 8: never two active cards, even with two administrators at once (integration)', () => {
    expect(files(8)).toContain('tests/integration/cards.test.ts');
  });

  it('criterion 11: forbidden from the server (pgTAP and integration)', () => {
    expect(files(11)).toEqual(
      expect.arrayContaining([
        'supabase/tests/cards_v2.test.sql',
        'tests/integration/cards.test.ts',
      ]),
    );
  });

  it('criteria 5 and 12 are proved on the tablet too', () => {
    expect(
      files(5).some((file) => /\.tablet\.test\.tsx$|^e2e\/tablet.*\.spec\.ts$/.test(file)),
    ).toBe(true);
    expect(files(12).some((file) => /^e2e\/tablet.*\.spec\.ts$/.test(file))).toBe(true);
  });

  it('criteria 8–11 are proved in a phone E2E with the fake card', () => {
    for (const criterion of [8, 9, 10, 11]) {
      expect(files(criterion)).toContain('e2e/cards-v2.spec.ts');
    }
  });

  it('criterion 13: CI runs unit, pgTAP, integration, bundle and the E2E of phone and tablet', () => {
    expect(cited(13)).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml › npm test',
        '.github/workflows/ci.yml › npm run db:test',
        '.github/workflows/ci.yml › npm run test:integration',
        '.github/workflows/ci.yml › npm run build && npm run check:bundle',
        '.github/workflows/ci.yml › npm run e2e',
        "playwright.config.ts › name: 'phone'",
        "playwright.config.ts › name: 'tablet'",
      ]),
    );
  });
});

describe('customers-v2 closing documents', () => {
  it.each(DOCUMENTS)('%s holds no key or token', (path) => {
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/sb_secret_|sb_publishable_|eyJhbGciOi|service_role_key/i);
  });

  it.each(DOCUMENTS)('%s names only made-up or the bar’s own email addresses', (path) => {
    const emails = readFileSync(path, 'utf8').match(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
    // The commit trailer quoted in todo.md is a no-reply address, nobody's contact; `nome@esempio.it`
    // is the placeholder of the email fields (as in scripts/customersV2Docs.test.ts); the domain is
    // matched without case, like the app does (`Rossi@Example.COM` is the spec's example).
    const allowed = /@(example\.com|enjoygaeta\.it)$|^nome@esempio\.it$|^noreply@anthropic\.com$/i;
    expect(emails.filter((email) => !allowed.test(email))).toEqual([]);
  });

  it.each(DOCUMENTS)('%s holds no Italian phone number', (path) => {
    expect(readFileSync(path, 'utf8')).not.toMatch(/\+39\s?\d{6,}/);
  });
});
