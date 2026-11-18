import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REWARD_ERRCODES } from '../src/features/rewards/supabaseRewardsService';

// SPEC-rewards, "Code Style": only supabaseRewardsService.ts reads app.rewards or calls the rewards
// RPCs; components use RewardsService through useRewardsService(), never getSupabase().

const SRC = 'src';
const MIGRATIONS = 'supabase/migrations';
const SERVICE = 'src/features/rewards/supabaseRewardsService.ts';
const RPCS = ['create_reward', 'update_reward', 'set_reward_active'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [relative('.', path).split('\\').join('/')];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/** The SQLSTATEs every `*_rewards.sql` migration raises with `using errcode = '…'`, sorted. */
function raisedErrcodes(): string[] {
  const migrations = readdirSync(MIGRATIONS).filter((name) => name.endsWith('_rewards.sql'));
  if (migrations.length === 0) throw new Error('rewards migration not found');
  const codes = migrations.flatMap((name) =>
    [
      ...readFileSync(join(MIGRATIONS, name), 'utf8').matchAll(/errcode\s*=\s*'([0-9A-Z]{5})'/g),
    ].map((match) => match[1] ?? ''),
  );
  return [...new Set(codes)].toSorted((a, b) => a.localeCompare(b));
}

describe('rewards data boundary', () => {
  it('finds the application sources', () => {
    expect(files.map((file) => file.path)).toContain(SERVICE);
  });

  it('lets only the Supabase rewards service read app.rewards or call its RPCs', () => {
    const access = new RegExp(`\\.from\\(\\s*['"\`]rewards['"\`]|['"\`](${RPCS.join('|')})['"\`]`);
    const offenders = files.filter((file) => access.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([SERVICE]);
  });

  it('imports the Supabase rewards service only where it is injected (main.tsx)', () => {
    const importer = /from\s+['"][^'"]*supabaseRewardsService['"]/;
    const offenders = files
      .filter((file) => importer.test(file.text))
      .map((file) => file.path)
      .filter((path) => path !== 'src/main.tsx');
    expect(offenders).toEqual([]);
  });

  it('keeps getSupabase() out of the rewards feature, except in its service', () => {
    const offenders = files
      .filter((file) => file.path.startsWith('src/features/rewards/'))
      .filter((file) => file.path !== SERVICE)
      .filter((file) => /\bgetSupabase\b/.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('translates every errcode the rewards migrations raise', () => {
    const raised = raisedErrcodes();
    expect(raised.length).toBeGreaterThan(0);
    const untranslated = raised.filter((code) => !Object.hasOwn(REWARD_ERRCODES, code));
    expect(untranslated).toEqual([]);
  });
});
