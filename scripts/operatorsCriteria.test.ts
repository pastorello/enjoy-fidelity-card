import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findPrivilegedKeys } from './privilegedKeys.ts';

// SPEC-operators, task 26: every success criterion from 1 to 12 names the tests that prove it, and
// those tests exist in the file they name; criterion 5 also asks that the secret key never appears in
// src/, dist/ or a tracked file (dist/ is checked by `npm run check:bundle` right after the build, in CI
// too); the module's closing documents carry no secret and no real person's contact.

const PLAN = 'tasks/operators/plan.md';
const SECTION = '## Verifica dei criteri di successo';
const CRITERIA = 12;

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

/** Every file git tracks, the ones staged but not yet committed included. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '' && existsSync(path) && statSync(path).isFile());
}

/** The text of a file, or '' for a binary one (fonts, images): a key is text. */
function textOf(path: string): string {
  const buffer = readFileSync(path);
  return buffer.includes(0) ? '' : buffer.toString('utf8');
}

const DOCUMENTS = [
  PLAN,
  'tasks/operators/todo.md',
  'docs/specs/SPEC-operators.md',
  'brain/STATUS.md',
  'brain/HANDOFF.md',
];

describe('operators success criteria', () => {
  const all = proofs();

  it('the plan lists the 12 criteria in order', () => {
    expect(rows().map((row) => row.criterion)).toEqual(
      Array.from({ length: CRITERIA }, (_, index) => index + 1),
    );
  });

  it('the plan proves each of the criteria 1–12 with at least one test', () => {
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

  it('criteria 1 and 2 are proved by the real email (Mailpit) and a phone E2E', () => {
    for (const criterion of [1, 2]) {
      expect(files(criterion)).toEqual(
        expect.arrayContaining(['tests/integration/operators.test.ts', 'e2e/operators.spec.ts']),
      );
    }
  });

  it('criteria 3 and 8 are proved in integration, 5 in pgTAP and integration', () => {
    expect(files(3).some((file) => file.startsWith('tests/integration/'))).toBe(true);
    expect(files(8).some((file) => file.startsWith('tests/integration/'))).toBe(true);
    expect(files(5).some((file) => file.startsWith('supabase/tests/'))).toBe(true);
    expect(files(5).some((file) => file.startsWith('tests/integration/'))).toBe(true);
    expect(files(5)).toContain('scripts/operatorsCriteria.test.ts');
  });

  it('criterion 4 is proved in unit and component tests, criterion 10 in pgTAP, component and tablet E2E', () => {
    expect(files(4)).toEqual(
      expect.arrayContaining([
        'src/features/operators/supabaseOperatorsService.test.ts',
        'src/features/operators/InviteForm.test.tsx',
      ]),
    );
    expect(files(10).some((file) => file.startsWith('supabase/tests/'))).toBe(true);
    expect(files(10).some((file) => /^src\/.*\.test\.tsx$/.test(file))).toBe(true);
    expect(files(10).some((file) => /^e2e\/tablet.*\.spec\.ts$/.test(file))).toBe(true);
  });

  it('criteria 6 and 7 are proved in a phone E2E, 7 also on the tablet', () => {
    expect(files(6)).toContain('e2e/operators.spec.ts');
    expect(files(7)).toContain('e2e/operators.spec.ts');
    expect(files(7).some((file) => /^e2e\/tablet.*\.spec\.ts$/.test(file))).toBe(true);
  });

  it('criterion 12: CI runs pgTAP, the unit tests, the served function, integration and both E2E projects', () => {
    const steps = all
      .filter((proof) => proof.criterion === 12)
      .map((proof) => `${proof.file} › ${proof.title}`);
    expect(steps).toEqual(
      expect.arrayContaining([
        '.github/workflows/ci.yml › npm run db:test',
        '.github/workflows/ci.yml › npm test',
        '.github/workflows/ci.yml › npx supabase functions serve',
        '.github/workflows/ci.yml › npm run test:integration',
        '.github/workflows/ci.yml › npm run e2e',
        "playwright.config.ts › name: 'phone'",
        "playwright.config.ts › name: 'tablet'",
      ]),
    );
  });
});

describe('operators secret key (criterion 5)', () => {
  it('appears in no file of src/', () => {
    const offenders = trackedFiles()
      .filter((path) => path.startsWith('src/'))
      .filter((path) => findPrivilegedKeys(textOf(path)).length > 0);
    expect(offenders).toEqual([]);
  });

  it('appears in no tracked file of the repository', () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((path) =>
      findPrivilegedKeys(textOf(path)).map((kind) => `${path}: ${kind}`),
    );
    expect(offenders).toEqual([]);
  });

  it('is never in dist/: check:bundle looks for it after every build, CI included', () => {
    expect(readFileSync('scripts/check-bundle.ts', 'utf8')).toContain('findPrivilegedKeys');
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('npm run build && npm run check:bundle');
  });

  it('the local env file of the functions stays out of git', () => {
    // `git check-ignore` exits with 0 only when the path is ignored.
    expect(() =>
      execFileSync('git', ['check-ignore', '-q', 'supabase/functions/.env'], { stdio: 'ignore' }),
    ).not.toThrow();
    expect(trackedFiles()).not.toContain('supabase/functions/.env');
  });
});

describe('operators closing documents', () => {
  it.each(DOCUMENTS)('%s holds no key or token', (path) => {
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/sb_secret_[A-Za-z0-9]|sb_publishable_[A-Za-z0-9]|eyJhbGciOi/);
    expect(findPrivilegedKeys(text)).toEqual([]);
  });

  it.each(DOCUMENTS)('%s names only made-up or the bar’s own email addresses', (path) => {
    // `supabase-js@2.119.0` is a package version, not an address: a domain never starts with a digit.
    const emails = readFileSync(path, 'utf8').match(/[\w.%+-]+@[A-Za-z][\w-]*(\.[\w-]+)+/g) ?? [];
    // `nome@esempio.it` and `marco@esempio.it` are the placeholders of the wireframe (esempio = example),
    // `x@y.z` the shape the form checks; the commit trailer quoted in todo.md is a no-reply address.
    const allowed = /@(example\.com|esempio\.it|enjoygaeta\.it)$|^noreply@anthropic\.com$|^x@y\.z$/;
    expect(emails.filter((email) => !allowed.test(email))).toEqual([]);
  });
});
