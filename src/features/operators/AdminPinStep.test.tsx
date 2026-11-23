import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminPinStep } from './AdminPinStep';
import type { PinRefusal } from './types';

// The PIN step of an admin action on the till tablet (SPEC-operators Open Questions 11): the
// PinPad of /cassa under the question, the PIN sent once at the 4th digit, then "PIN errato" with
// the attempts left or the lock counted down, as on /cassa. Invented names only.

const QUESTION = 'Per rendere Luca Prova amministratore dal tablet serve il tuo PIN.';

afterEach(() => {
  vi.useRealTimers();
});

function renderStep(
  onPin: (pin: string) => Promise<PinRefusal | null>,
  lockSeconds = 0,
  onLocked = vi.fn<() => void>(),
) {
  render(
    <AdminPinStep
      question={QUESTION}
      cashierName="Giulia Prova"
      lockSeconds={lockSeconds}
      onPin={onPin}
      onLocked={onLocked}
    />,
  );
  return { onLocked };
}

function keypad() {
  return screen.getByRole('group', { name: 'Tastierino PIN' });
}

/** One tap after the other, as a finger does. */
async function type(pin: string) {
  await pin
    .split('')
    .reduce<Promise<void>>(
      (previous, digit) =>
        previous.then(() => userEvent.click(within(keypad()).getByRole('button', { name: digit }))),
      Promise.resolve(),
    );
}

describe('AdminPinStep', () => {
  it('asks the question and the PIN of the cashier, by name', () => {
    renderStep(() => Promise.resolve(null));
    expect(screen.getByText(QUESTION)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'PIN di Giulia Prova' })).toBeVisible();
    expect(screen.getByRole('img', { name: '0 cifre su 4 inserite' })).toBeVisible();
    expect(
      screen.getByText('Dopo 5 PIN errati il tablet si blocca per qualche minuto.'),
    ).toBeVisible();
  });

  it('sends the PIN once, at the 4th digit, and empties the dots', async () => {
    const onPin = vi.fn<(pin: string) => Promise<PinRefusal | null>>(() => Promise.resolve(null));
    renderStep(onPin);
    await type('246');
    expect(onPin).not.toHaveBeenCalled();
    await type('8');
    expect(onPin).toHaveBeenCalledExactlyOnceWith('2468');
    expect(await screen.findByRole('img', { name: '0 cifre su 4 inserite' })).toBeVisible();
  });

  it('keeps the keypad off while the server checks the PIN', async () => {
    let answer!: (refusal: PinRefusal | null) => void;
    renderStep(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await type('2468');
    expect(keypad()).toBeDisabled();
    await act(async () => {
      answer(null);
      await Promise.resolve();
    });
    expect(keypad()).toBeEnabled();
  });

  it('says "PIN errato" with the attempts left, as /cassa', async () => {
    const { onLocked } = renderStep(() =>
      Promise.resolve({ status: 'wrong-pin', attemptsLeft: 3 }),
    );
    await type('0000');
    expect(await screen.findByRole('alert')).toHaveTextContent('PIN errato. Tentativi rimasti: 3');
    expect(keypad()).toBeEnabled();
    expect(onLocked).not.toHaveBeenCalled();
  });

  it('tells the caller when the server locks the till, so the identity is read again', async () => {
    const { onLocked } = renderStep(() =>
      Promise.resolve({ status: 'pin-locked', lockSecondsLeft: 300 }),
    );
    await type('0000');
    expect(await screen.findByRole('timer')).toBeVisible();
    expect(onLocked).toHaveBeenCalledOnce();
  });

  it('counts the lock down in minutes and seconds with the keypad off, then lets the PIN in again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderStep(() => Promise.resolve({ status: 'pin-locked', lockSecondsLeft: 65 }));
    await type('0000');
    expect(await screen.findByRole('timer')).toHaveTextContent(
      'Troppi tentativi: riprova tra 1:05',
    );
    expect(keypad()).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });
    expect(screen.queryByRole('timer')).toBeNull();
    expect(keypad()).toBeEnabled();
  });

  it('starts locked when the identity says the till is locked', () => {
    renderStep(() => Promise.resolve(null), 240);
    expect(screen.getByRole('timer')).toHaveTextContent('Troppi tentativi: riprova tra 4:00');
    expect(keypad()).toBeDisabled();
  });

  it('a new attempt clears the last "PIN errato"', async () => {
    const answers: (PinRefusal | null)[] = [{ status: 'wrong-pin', attemptsLeft: 4 }, null];
    renderStep(() => Promise.resolve(answers.shift() ?? null));
    await type('0000');
    expect(await screen.findByRole('alert')).toBeVisible();
    await type('2468');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
