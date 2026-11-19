import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom computes no layout and Vitest stubs CSS modules, so the rules that keep the till screens in
// shape are read from their stylesheets (as pinPadCss.test.ts does). The layouts themselves are
// measured in e2e/tablet-layout.spec.ts.

function declarationsOf(file: string, selector: string): string {
  const css = readFileSync(file, 'utf8');
  const escaped = selector.replace(/[.[\]'=]/g, '\\$&');
  return new RegExp(`(?:^|\\}|\\*/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

const CHIP = 'src/features/tablet-kiosk/CashierChip.module.css';
const PIN_SETTINGS = 'src/features/tablet-kiosk/PinSettingsPage.module.css';
const PIN_PAD = 'src/features/tablet-kiosk/PinPad.module.css';

describe('"Alla cassa: <nome> · Cambia" chip', () => {
  it('can shrink in a narrow header, keeping its 48 px height', () => {
    const chip = declarationsOf(CHIP, '.chip');
    expect(chip).toMatch(/min-width:\s*0/);
    expect(chip).not.toMatch(/flex-shrink:\s*0/);
    expect(chip).toMatch(/min-height:\s*var\(--touch-target\)/);
  });

  it('cuts a long name with an ellipsis, never the word "Cambia"', () => {
    const name = declarationsOf(CHIP, '.name');
    expect(name).toMatch(/overflow:\s*hidden/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(declarationsOf(CHIP, '.change')).toMatch(/flex-shrink:\s*0/);
  });

  it('shows only the initial and "Cambia" under the tablet width, the name hidden for the eyes only', () => {
    const css = readFileSync(CHIP, 'utf8');
    const narrow = /@media \(max-width: 1023px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(narrow).toMatch(/\.name,\s*\.separator\s*\{[^}]*clip-path:\s*inset\(50%\)/);
  });
});

describe('PIN della cassa', () => {
  it('sets its errors in the danger colour, as /cassa does', () => {
    expect(declarationsOf(PIN_SETTINGS, ".message[role='alert']")).toMatch(
      /color:\s*var\(--color-danger-text\)/,
    );
  });
});

describe('PinPad spacing (wireframe "Tablet: cambio operatore")', () => {
  it('keeps the title 12 px above the dots, and the keypad 24 px below them', () => {
    expect(declarationsOf(PIN_PAD, '.display')).toMatch(/gap:\s*12px/);
    expect(declarationsOf(PIN_PAD, '.pinPad')).toMatch(/gap:\s*24px/);
  });
});
