import { useLayoutEffect, useRef } from 'react';
import { Icon } from '../../shared/ui/Icon';
import styles from './PinPad.module.css';

/** Digits of the cashier PIN (SPEC-tablet-kiosk, point 3). */
export const PIN_LENGTH = 4;

type PinPadProps = {
  /** The digits entered so far. The PIN lives only in the caller's React state. */
  value: string;
  onChange: (next: string) => void;
  /** Called once with the PIN when the fourth digit is tapped. */
  onComplete: (pin: string) => void;
  /** No operator chosen, verification running or lockout: taps are ignored. */
  disabled?: boolean;
};

const DOT_SIZE = 20;
const DOT_GAP = 16;
const DOT_STROKE = 2;
const DOTS_WIDTH = PIN_LENGTH * DOT_SIZE + (PIN_LENGTH - 1) * DOT_GAP;

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

function dotsLabel(count: number): string {
  return count === 1
    ? `1 cifra su ${PIN_LENGTH} inserita`
    : `${count} cifre su ${PIN_LENGTH} inserite`;
}

/**
 * The PIN pad of /cassa and /impostazioni/pin (wireframe "Tablet: cambio operatore"): 4 dots that
 * never show the digits, then 1–9, an empty cell, 0 and "Cancella ultima cifra" on 88 px keys.
 * Buttons only, so no system keyboard opens and no physical key enters the PIN.
 *
 * The digits typed so far are tracked in a ref as well as in `value`: two taps that land before
 * the parent re-renders both see the same stale `value`, and without the ref the second would
 * complete the PIN twice.
 */
export function PinPad({ value, onChange, onComplete, disabled = false }: PinPadProps) {
  const entered = useRef(value);
  useLayoutEffect(() => {
    entered.current = value;
  });

  function type(digit: string) {
    if (disabled || entered.current.length >= PIN_LENGTH) return;
    const next = entered.current + digit;
    entered.current = next;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete(next);
  }

  function backspace() {
    if (disabled || entered.current.length === 0) return;
    const next = entered.current.slice(0, -1);
    entered.current = next;
    onChange(next);
  }

  const count = Math.min(value.length, PIN_LENGTH);
  return (
    <div className={styles.pinPad}>
      {/* An SVG, so `role="img"` sits on an element that is one (wireframe: 20 px dots, 16 px apart). */}
      <svg
        role="img"
        aria-label={dotsLabel(count)}
        className={styles.dots}
        width={DOTS_WIDTH}
        height={DOT_SIZE}
        viewBox={`0 0 ${DOTS_WIDTH} ${DOT_SIZE}`}
      >
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <circle
            key={index}
            className={styles.dot}
            data-filled={index < count}
            cx={index * (DOT_SIZE + DOT_GAP) + DOT_SIZE / 2}
            cy={DOT_SIZE / 2}
            r={(DOT_SIZE - DOT_STROKE) / 2}
            strokeWidth={DOT_STROKE}
          />
        ))}
      </svg>
      <fieldset aria-label="Tastierino PIN" disabled={disabled} className={styles.keypad}>
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={disabled}
            className={styles.key}
            onClick={() => type(digit)}
          >
            {digit}
          </button>
        ))}
        <span aria-hidden="true" />
        <button type="button" disabled={disabled} className={styles.key} onClick={() => type('0')}>
          0
        </button>
        <button
          type="button"
          aria-label="Cancella ultima cifra"
          disabled={disabled}
          className={styles.key}
          onClick={backspace}
        >
          <Icon name="delete" size={28} />
        </button>
      </fieldset>
    </div>
  );
}
