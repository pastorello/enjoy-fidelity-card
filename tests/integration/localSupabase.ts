import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Keys of the LOCAL stack, read from `supabase status`. The secret key never leaves test code. */
export type LocalSupabase = { url: string; publishableKey: string; secretKey: string };

export function localSupabase(): LocalSupabase {
  let output: string;
  try {
    output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error('Local Supabase is not running: start it with `npm run db:start`.');
  }
  const value = (name: string) => {
    const match = new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm').exec(output)?.[1];
    if (!match) throw new Error(`\`supabase status\` printed no ${name}.`);
    return match;
  };
  const url = value('API_URL');
  const { hostname } = new URL(url);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error(`Integration tests only run against the local stack, not ${url}.`);
  }
  return { url, publishableKey: value('PUBLISHABLE_KEY'), secretKey: value('SECRET_KEY') };
}

/** A client that keeps its session in memory only and never refreshes it on its own. */
export function memoryClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function databaseContainer(): string {
  const config = readFileSync('supabase/config.toml', 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!projectId) throw new Error('supabase/config.toml: missing project_id.');
  return `supabase_db_${projectId}`;
}

/**
 * Runs SQL as the database owner inside the local database container (no psql needed on the
 * host). `vars` become psql variables: use them as :'name' so values are always quoted.
 */
export function runSql(sql: string, vars: Record<string, string> = {}): string {
  return execFileSync('docker', psqlArgs(vars), { input: sql, encoding: 'utf8' }).trim();
}

/**
 * `runSql` in its own session without waiting for it: the promise settles when the session ends.
 * Used to hold a transaction open while the code under test runs into it.
 */
export function runSqlInBackground(
  sql: string,
  vars: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', psqlArgs(vars), { encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
    child.stdin?.end(sql);
  });
}

function psqlArgs(vars: Record<string, string>): string[] {
  const args = ['exec', '-i', databaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres'];
  args.push('-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t');
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`);
  return args;
}

/**
 * Runs `call` in a psql transaction as the Auth user `userId` (its JWT claims, so auth.uid()
 * is that user) and keeps the transaction open for `seconds`; resolves once the call is done
 * and the transaction is waiting. `released` settles when the transaction has committed.
 */
export async function holdOpenAs(
  userId: string,
  call: string,
  vars: Record<string, string>,
  seconds: number,
): Promise<{ released: Promise<string> }> {
  const marker = `hold-${randomUUID()}`;
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  const released = runSqlInBackground(
    `begin;
     select set_config('request.jwt.claims', :'claims', true);
     ${call};
     select pg_sleep(${seconds}) /* ${marker} */;
     commit;`,
    { ...vars, claims },
  );
  await waitUntil(() => {
    const sleeping = runSql(
      `select count(*) from pg_stat_activity
       where pid <> pg_backend_pid() and query like '%pg_sleep%' and query like :'pattern';`,
      { pattern: `%${marker}%` },
    );
    if (sleeping !== '1') throw new Error('The transaction is not held open yet');
  });
  return { released };
}

/** Waits until at least `count` sessions are blocked on a lock: proof they are in flight together. */
export async function waitForBlocked(count: number): Promise<void> {
  await waitUntil(() => {
    const blocked = Number(
      runSql(
        `select count(*) from pg_stat_activity
         where pid <> pg_backend_pid() and wait_event_type = 'Lock';`,
      ),
    );
    if (blocked < count) throw new Error(`${blocked} of ${count} requests are waiting`);
  });
}

/** Retries `check` every 20 ms until it stops throwing, for at most 2 seconds. */
async function waitUntil(check: () => void, deadline = Date.now() + 2000): Promise<void> {
  try {
    check();
  } catch (error) {
    if (Date.now() > deadline) throw error;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitUntil(check, deadline);
  }
}
