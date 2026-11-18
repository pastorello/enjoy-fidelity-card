import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom computes no layout and Vitest stubs CSS modules, so the ESPORTA DATI pair is read from its
// stylesheet (as amountKeypadCss.test.ts does); e2e/export.spec.ts measures it at 390×844.
const css = readFileSync('src/features/export/ExportSection.module.css', 'utf8').replaceAll(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function declarationsOf(selector: string): string {
  const escaped = selector.replace(/[.[\]'=>]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('ExportSection stylesheet (SPEC-export, criteria 1 and 9)', () => {
  it('lays the two buttons side by side', () => {
    expect(declarationsOf('.actions')).toMatch(/grid-template-columns:\s*1fr 1fr/);
  });

  it('keeps each button at least the 48 px touch target', () => {
    expect(declarationsOf('.actions > button')).toMatch(/min-height:\s*var\(--touch-target\)/);
  });
});
