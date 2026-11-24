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

/**
 * Creates `names.length` customers at once, as the seed does (supabase/seed.sql): too many for the
 * Nuovo cliente form in one test. Created by «Admin Prova», with consent, no card and no
 * movement; the first name is the oldest, one second apart, so the home lists them newest first
 * in a known order. Returns their ids in the order of `names`.
 */
export function createCustomers(names: string[]): string[] {
  const output = runSql(
    `insert into app.customers (name, privacy_consent_at, created_at, created_by, create_operation_id)
     select fake.name, now(), now() - make_interval(secs => fake.total - fake.position),
       (select id from app.operators where name = 'Admin Prova'), gen_random_uuid()
     from (
       select name, position, count(*) over () as total
       from jsonb_array_elements_text(:'names'::jsonb) with ordinality as list (name, position)
     ) as fake
     order by fake.position
     returning id, name;`,
    { names: JSON.stringify(names) },
  );
  const ids = new Map(
    output.split('\n').map((line) => {
      const [id = '', name = ''] = line.split('|');
      return [name, id] as const;
    }),
  );
  return names.map((name) => {
    const id = ids.get(name);
    if (id === undefined) throw new Error(`Customer not created: ${name}`);
    return id;
  });
}
