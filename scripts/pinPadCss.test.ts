import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom computes no layout and Vitest stubs CSS modules, so the PinPad key height is read from its
// stylesheet: 88 px as in the wireframe "Tablet: cambio operatore", well above the 48 px target.
const css = readFileSync('src/features/tablet-kiosk/PinPad.module.css', 'utf8');

function declarationsOf(selector: string): string {
  const escaped = selector.replace(/[.[\]'=]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('PinPad stylesheet', () => {
  it('makes every key 88 px tall', () => {
    const height = Number(/(?:^|[\s;])height:\s*(\d+)px/.exec(declarationsOf('.key'))?.[1]);
    expect(height).toBeGreaterThanOrEqual(88);
  });

  it('never lets a key get narrower than the touch target', () => {
    expect(declarationsOf('.key')).toMatch(/min-width:\s*var\(--touch-target\)/);
  });

  it('uses design-system tokens only for colours', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});
