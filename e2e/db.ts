import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function databaseContainer(): string {
  const config = readFileSync('supabase/config.toml', 'utf8');
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!projectId) throw new Error('supabase/config.toml: missing project_id.');
  return `supabase_db_${projectId}`;
}

/**
 * Runs SQL as the database owner inside the LOCAL database container (the same helper as
 * tests/integration/localSupabase.ts): only for what the app cannot do or show, such as a device
 * row that the API never exposes. `vars` become psql variables: use them as :'name'.
 */
export function runSql(sql: string, vars: Record<string, string> = {}): string {
  const args = ['exec', '-i', databaseContainer(), 'psql', '-U', 'postgres', '-d', 'postgres'];
  args.push('-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t');
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`);
  return execFileSync('docker', args, { input: sql, encoding: 'utf8' }).trim();
}
