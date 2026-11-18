import { Icon } from '../../shared/ui/Icon';
import styles from './AmountKeypad.module.css';
import { amountKeypadReducer, freePointsKeypadReducer, type AmountKey } from './points';

/**
 * `amount`: cents of a purchase, with "00" and 64 px keys (wireframe "Registra spesa").
 * `points`: points of a free reward, an empty cell instead of "00" and 56 px keys (wireframe
 * "Premio libero").
 */
export type KeypadVariant = 'amount' | 'points';

type AmountKeypadProps = {
  /** Current value: cents for `amount`, points for `points`. */
  value: number;
  onChange: (next: number) => void;
  variant?: KeypadVariant;
};

const DIGIT_ROWS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * The in-app numeric keypad: a fieldset (implicit role "group", lint prefers it to `role`) of
 * buttons only, so the system keyboard never opens. Every key goes through the pure reducers of
 * `points.ts` (digits on the right, limits, leading zeros).
 */
export function AmountKeypad({ value, onChange, variant = 'amount' }: AmountKeypadProps) {
  function press(key: AmountKey) {
    const next =
      variant === 'amount'
        ? amountKeypadReducer(value, key)
        : key === '00'
          ? value
          : freePointsKeypadReducer(value, key);
    onChange(next);
  }

  return (
    <fieldset aria-label="Tastierino numerico" data-variant={variant} className={styles.keypad}>
      {DIGIT_ROWS.map((digit) => (
        <button key={digit} type="button" className={styles.key} onClick={() => press(digit)}>
          {digit}
        </button>
      ))}
      {variant === 'amount' ? (
        <button
          type="button"
          aria-label="Doppio zero"
          className={styles.key}
          onClick={() => press('00')}
        >
          00
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      <button type="button" className={styles.key} onClick={() => press('0')}>
        0
      </button>
      <button
        type="button"
        aria-label="Cancella ultima cifra"
        className={styles.key}
        onClick={() => press('backspace')}
      >
        <Icon name="delete" size={28} />
      </button>
    </fieldset>
  );
}
