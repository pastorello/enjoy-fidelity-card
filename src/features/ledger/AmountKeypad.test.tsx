import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AmountKeypad, type KeypadVariant } from './AmountKeypad';

/** A screen that keeps the value, as PurchasePage and FreeRewardForm will. */
function Harness({ variant, initial = 0 }: { variant?: KeypadVariant; initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <output aria-label="Valore">{value}</output>
      <AmountKeypad value={value} onChange={setValue} {...(variant ? { variant } : {})} />
    </>
  );
}

function keypad() {
  return screen.getByRole('group', { name: 'Tastierino numerico' });
}

function key(name: string) {
  return within(keypad()).getByRole('button', { name });
}

/** Presses the keys one after the other, in order. */
async function press(...names: string[]) {
  await names.reduce<Promise<void>>(
    (previous, name) => previous.then(() => userEvent.click(key(name))),
    Promise.resolve(),
  );
}

function shown() {
  return screen.getByLabelText('Valore').textContent;
}

describe('AmountKeypad', () => {
  it('enters cents as on a POS: 1-2-5-0 gives 1250 (criterion 1)', async () => {
    render(<Harness />);
    await press('1', '2', '5', '0');
    expect(shown()).toBe('1250');
  });

  it('adds two zeros with "Doppio zero" and removes the last digit with "Cancella ultima cifra"', async () => {
    render(<Harness />);
    await press('1', 'Doppio zero');
    expect(shown()).toBe('100');
    await press('Cancella ultima cifra');
    expect(shown()).toBe('10');
  });

  it('ignores leading zeros and keeps 0 when cancelling on 0', async () => {
    render(<Harness />);
    await press('0', 'Doppio zero', '5');
    expect(shown()).toBe('5');
    await press('Cancella ultima cifra', 'Cancella ultima cifra');
    expect(shown()).toBe('0');
  });

  it('ignores digits past 9.999.999 cents', async () => {
    render(<Harness initial={9_999_999} />);
    await press('1', 'Doppio zero');
    expect(shown()).toBe('9999999');
    render(<Harness initial={999_999} />);
    const [, second] = screen.getAllByRole('group', { name: 'Tastierino numerico' });
    await userEvent.click(within(second!).getByRole('button', { name: 'Doppio zero' }));
    expect(screen.getAllByLabelText('Valore')[1]).toHaveTextContent('999999');
  });

  it('reports the next value through onChange, computed by the reducer', async () => {
    const onChange = vi.fn<(next: number) => void>();
    render(<AmountKeypad value={12} onChange={onChange} />);
    await userEvent.click(key('5'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(125);
  });

  it('lays out 1-9, "00", 0 and backspace in the wireframe order, with accessible names', () => {
    render(<Harness />);
    const names = within(keypad())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(names).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'Doppio zero',
      '0',
      'Cancella ultima cifra',
    ]);
    expect(key('Doppio zero')).toHaveTextContent('00');
    for (const button of within(keypad()).getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });

  it('never renders an input that would open the system keyboard', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('input, textarea, [contenteditable]')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  describe('points variant (free reward)', () => {
    it('has an empty cell instead of "00" and caps at 99.999 points', async () => {
      render(<Harness variant="points" initial={9_999} />);
      expect(within(keypad()).queryByRole('button', { name: 'Doppio zero' })).toBeNull();
      expect(within(keypad()).getAllByRole('button')).toHaveLength(11);
      await press('9');
      expect(shown()).toBe('99999');
      await press('9');
      expect(shown()).toBe('99999');
      await press('Cancella ultima cifra');
      expect(shown()).toBe('9999');
    });

    it('keeps the empty cell in the grid, hidden from assistive technology', () => {
      render(<Harness variant="points" />);
      const cells = [...keypad().children];
      expect(cells).toHaveLength(12);
      expect(cells[9]).toHaveAttribute('aria-hidden', 'true');
      expect(cells[9]?.tagName).not.toBe('BUTTON');
    });
  });

  describe('touch targets', () => {
    // Key heights (64 / 56 px) are checked on the CSS in scripts/amountKeypadCss.test.ts.
    it('marks the variant on the group so the CSS can size the keys', () => {
      render(<Harness variant="points" />);
      expect(keypad()).toHaveAttribute('data-variant', 'points');
    });
  });
});
