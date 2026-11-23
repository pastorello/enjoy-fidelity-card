import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom computes no styles and Vitest stubs CSS modules, so the disabled look of the form fields is
// read from the stylesheets. A field inside `<fieldset disabled>` (the invite form while the list
// loads) must look inactive like a disabled Button ("Non disponibile" of the design system): muted
// surface and text, never the white field with the dark border of an enabled one.
const textField = readFileSync('src/shared/ui/TextField.module.css', 'utf8');
const roleFieldset = readFileSync('src/features/operators/RoleFieldset.module.css', 'utf8');

function declarationsOf(css: string, selector: string): string {
  const escaped = selector.replace(/[.[\]'=():]/g, '\\$&');
  return new RegExp(`(?:^|\\}|\\*/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('disabled form fields', () => {
  it('TextField: a disabled input (also inside a disabled fieldset) is muted', () => {
    const rules = declarationsOf(textField, '.input:disabled');
    expect(rules).toMatch(/background:\s*var\(--color-surface-raised\)/);
    expect(rules).toMatch(/border-color:\s*var\(--color-divider\)/);
    expect(rules).toMatch(/(?:^|[\s;])color:\s*var\(--color-ink-muted\)/);
    expect(rules).toMatch(/cursor:\s*not-allowed/);
  });

  it('RoleFieldset: the options of a disabled fieldset are grey like a disabled option', () => {
    const rules = declarationsOf(roleFieldset, 'fieldset:disabled .option');
    expect(rules).toMatch(/(?:^|[\s;])color:\s*var\(--color-ink-muted\)/);
    expect(rules).toMatch(/cursor:\s*not-allowed/);
  });
});
