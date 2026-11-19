import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PIN_LENGTH, PinPad } from './PinPad';

type HarnessProps = {
  disabled?: boolean;
  onComplete?: (pin: string) => void;
};

/** A screen that keeps the PIN in React state only, as /cassa and /impostazioni/pin do. */
function ignore() {}

function Harness({ disabled = false, onComplete = ignore }: HarnessProps) {
  const [pin, setPin] = useState('');
  return (
    <>
      <PinPad value={pin} onChange={setPin} onComplete={onComplete} disabled={disabled} />
      <button type="button" onClick={() => setPin('')}>
        Svuota
      </button>
    </>
  );
}

function keypad() {
  return screen.getByRole('group', { name: 'Tastierino PIN' });
}

function key(name: string) {
  return within(keypad()).getByRole('button', { name });
}

async function press(...names: string[]) {
  await names.reduce<Promise<void>>(
    (previous, name) => previous.then(() => userEvent.click(key(name))),
    Promise.resolve(),
  );
}

function dots() {
  return screen.getByRole('img', { name: / su 4 inserit[ae]$/ });
}

describe('PinPad', () => {
  it('has 4 digits', () => {
    expect(PIN_LENGTH).toBe(4);
  });

  it('starts empty: "0 cifre su 4 inserite", four empty dots', () => {
    render(<Harness />);
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
    const cells = [...dots().children];
    expect(cells).toHaveLength(4);
    for (const cell of cells) expect(cell).toHaveAttribute('data-filled', 'false');
  });

  it('fills a dot per tapped digit and empties the last one with "Cancella ultima cifra"', async () => {
    render(<Harness />);
    await press('7', '3');
    expect(dots()).toHaveAccessibleName('2 cifre su 4 inserite');
    expect([...dots().children].map((cell) => cell.getAttribute('data-filled'))).toEqual([
      'true',
      'true',
      'false',
      'false',
    ]);
    await press('Cancella ultima cifra');
    // Singular in Italian: "1 cifra su 4 inserita".
    expect(dots()).toHaveAccessibleName('1 cifra su 4 inserita');
    await press('Cancella ultima cifra', 'Cancella ultima cifra');
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
  });

  it('never shows the digits themselves', async () => {
    const { container } = render(<Harness />);
    await press('9', '8');
    expect(dots()).not.toHaveTextContent(/\d/);
    expect(container.querySelector('input, textarea, [contenteditable]')).toBeNull();
  });

  it('calls onComplete once with the PIN at the fourth digit, and ignores further digits', async () => {
    const onComplete = vi.fn<(pin: string) => void>();
    render(<Harness onComplete={onComplete} />);
    await press('1', '2', '3');
    expect(onComplete).not.toHaveBeenCalled();
    await press('4');
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('1234');
    await press('5', '6');
    expect(onComplete).toHaveBeenCalledOnce();
    expect(dots()).toHaveAccessibleName('4 cifre su 4 inserite');
  });

  it('calls onComplete once even when two digits land before a re-render', () => {
    const onComplete = vi.fn<(pin: string) => void>();
    const onChange = vi.fn<(pin: string) => void>();
    // The parent has not re-rendered yet: the value prop is still "123" for both taps.
    render(<PinPad value="123" onChange={onChange} onComplete={onComplete} />);
    fireEvent.click(key('4'));
    fireEvent.click(key('5'));
    expect(onComplete).toHaveBeenCalledExactlyOnceWith('1234');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('1234');
  });

  it('completes again after the caller empties the PIN (wrong PIN, other operator)', async () => {
    const onComplete = vi.fn<(pin: string) => void>();
    render(<Harness onComplete={onComplete} />);
    await press('1', '1', '1', '1');
    await userEvent.click(screen.getByRole('button', { name: 'Svuota' }));
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
    await press('2', '2', '2', '2');
    expect(onComplete.mock.calls).toEqual([['1111'], ['2222']]);
  });

  it('accepts no taps while disabled', async () => {
    const onComplete = vi.fn<(pin: string) => void>();
    render(<Harness disabled onComplete={onComplete} />);
    expect(keypad()).toBeDisabled();
    for (const button of within(keypad()).getAllByRole('button')) expect(button).toBeDisabled();
    await userEvent.click(key('1'));
    fireEvent.click(key('2'));
    expect(dots()).toHaveAccessibleName('0 cifre su 4 inserite');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('lays out 1-9, an empty cell, 0 and backspace as in the wireframe', () => {
    render(<Harness />);
    const cells = [...keypad().children];
    expect(cells).toHaveLength(12);
    expect(cells[9]).toHaveAttribute('aria-hidden', 'true');
    expect(cells[9]?.tagName).not.toBe('BUTTON');
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
      '0',
      'Cancella ultima cifra',
    ]);
    for (const button of within(keypad()).getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
    }
  });
});
