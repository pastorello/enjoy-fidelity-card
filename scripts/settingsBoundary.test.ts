import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC-settings, success criterion 7: only supabaseSettingsService.ts reaches app.settings or
// app.update_settings; components read the configuration only through useSettings().

const SRC = 'src';
const SERVICE = 'src/features/settings/supabaseSettingsService.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [relative('.', path).split('\\').join('/')];
  });
}

const files = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('settings data boundary', () => {
  it('finds the application sources', () => {
    expect(files.map((file) => file.path)).toContain(SERVICE);
  });

  it('lets only the Supabase settings service query app.settings or call update_settings', () => {
    const access = /\.from\(\s*['"`]settings['"`]|['"`]update_settings['"`]/;
    const offenders = files.filter((file) => access.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual([SERVICE]);
  });

  it('imports the Supabase settings service only where it is injected (main.tsx)', () => {
    const importer = /from\s+['"][^'"]*supabaseSettingsService['"]/;
    const offenders = files.filter((file) => importer.test(file.text)).map((file) => file.path);
    expect(offenders).toEqual(['src/main.tsx']);
  });

  it('gives components the configuration only through useSettings()', () => {
    const context = /\bSettingsContext\b|useContext\([^)]*Settings/;
    const offenders = files
      .filter((file) => file.path.endsWith('.tsx'))
      .filter((file) => file.path !== 'src/features/settings/SettingsProvider.tsx')
      .filter((file) => context.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
