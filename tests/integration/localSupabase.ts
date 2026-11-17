import { execFileSync } from 'node:child_process';
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
  const args = ['exec', '-i', databaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres'];
  args.push('-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t');
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`);
  return execFileSync('docker', args, { input: sql, encoding: 'utf8' }).trim();
}
