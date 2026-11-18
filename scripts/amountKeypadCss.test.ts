import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom computes no layout and Vitest stubs CSS modules, so the key heights of AmountKeypad are
// read from its stylesheet: 64 px on "Registra spesa", 56 px on "Premio libero" (wireframes),
// both above the 48 px touch target.
const css = readFileSync('src/features/ledger/AmountKeypad.module.css', 'utf8');

function declarationsOf(selector: string): string {
  const escaped = selector.replace(/[.[\]'=]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

function heightOf(selector: string): number {
  return Number(/(?:^|[\s;])height:\s*(\d+)px/.exec(declarationsOf(selector))?.[1]);
}

describe('AmountKeypad stylesheet', () => {
  it('makes amount keys 64 px tall and free reward keys 56 px tall', () => {
    expect(heightOf(".keypad[data-variant='amount'] .key")).toBe(64);
    expect(heightOf(".keypad[data-variant='points'] .key")).toBe(56);
  });

  it('never lets a key get narrower than the touch target', () => {
    expect(declarationsOf('.key')).toMatch(/min-width:\s*var\(--touch-target\)/);
  });
});
