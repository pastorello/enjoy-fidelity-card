import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC-customers, "Code Style": only supabaseCustomerService.ts reaches app.customers or calls the
// customers RPCs; components use CustomerService through the module's hooks, never getSupabase().

const SRC = 'src';
const SERVICE = 'src/features/customers/supabaseCustomerService.ts';
const RPCS = [
  'search_customers',
  'customers_served_today',
  'get_customer',
  'create_customer',
  'update_customer',
  'anonymize_customer',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [relative('.', path).split('\\').join('/')];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('customers data boundary', () => {
  it('finds the application sources', () => {
    expect(files.map((file) => file.path)).toContain(SERVICE);
  });

  it('lets only the Supabase customer service query app.customers or call its RPCs', () => {
    const access = new RegExp(
      `\\.from\\(\\s*['"\`]customers['"\`]|['"\`](${RPCS.join('|')})['"\`]`,
    );
    const offenders = files.filter((file) => access.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([SERVICE]);
  });

  it('imports the Supabase customer service only where it is injected (main.tsx)', () => {
    const importer = /from\s+['"][^'"]*supabaseCustomerService['"]/;
    const offenders = files
      .filter((file) => importer.test(file.text))
      .map((file) => file.path)
      .filter((path) => path !== 'src/main.tsx');
    expect(offenders).toEqual([]);
  });

  it('keeps getSupabase() out of the customers feature, except in its service', () => {
    const offenders = files
      .filter((file) => file.path.startsWith('src/features/customers/'))
      .filter((file) => file.path !== SERVICE)
      .filter((file) => /\bgetSupabase\b/.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
