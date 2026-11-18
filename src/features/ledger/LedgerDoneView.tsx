import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatInteger } from '../../shared/format';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { vibrate } from '../card-input/vibrate';
import { firstName } from '../cards/customerName';
import styles from './LedgerDoneView.module.css';

/** Seconds before going back to the card reading, and of the "Annulla" window (SPEC-ledger, 3). */
export const RETURN_AFTER_SECONDS = 10;

export type LedgerDoneViewProps = {
  /** "Spesa registrata" / "Premio riscattato". */
  title: string;
  /** "+12 punti a Maria Rossi". */
  summary: string;
  /** The server's balance after the movement. */
  balance: number;
  /** "12,50 € · oggi 10:42 · Giulia", from the movement the server returned. */
  details: string;
  customerId: string;
  customerName: string;
  /** "Annulla la spesa" / "Annulla il riscatto", followed by " · N s". */
  cancelLabel: string;
  /** Without it the "Annulla" button is not shown. */
  onCancel?: (() => void) | undefined;
};

function secondsText(seconds: number): string {
  return seconds === 1 ? '1 secondo' : `${seconds} secondi`;
}

/**
 * The confirmation of a movement just recorded (wireframes "Spesa registrata" and "Premio
 * riscattato"): no header, the check, the title (focused), NUOVO SALDO, a vibration where the
 * device has one, "Annulla" for 10 s, then back to `/` replacing the entry, so the system back
 * never returns to the keypad.
 */
export function LedgerDoneView({
  title,
  summary,
  balance,
  details,
  customerId,
  customerName,
  cancelLabel,
  onCancel,
}: LedgerDoneViewProps) {
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const vibrated = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(RETURN_AFTER_SECONDS);

  useEffect(() => {
    heading.current?.focus();
    if (vibrated.current) return;
    vibrated.current = true;
    vibrate(200);
  }, []);

  // One tick a second for the whole countdown, cleared when the view goes away.
  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (secondsLeft === 0) void navigate('/', { replace: true });
  }, [secondsLeft, navigate]);

  const progress = (secondsLeft / RETURN_AFTER_SECONDS) * 100;

  return (
    <div className={styles.screen}>
      <main className={styles.main}>
        <span className={styles.check}>
          <Icon name="check" size={48} />
        </span>
        <h1 ref={heading} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
        <p className={styles.summary}>{summary}</p>
        <section aria-label="Nuovo saldo" className={styles.balance}>
          <span className={styles.balanceLabel}>NUOVO SALDO</span>
          <p className={styles.balanceValue}>
            <span className={styles.balanceFigure}>{formatInteger(balance)}</span>{' '}
            <span className={styles.balanceUnit}>{balance === 1 ? 'punto' : 'punti'}</span>
          </p>
        </section>
        <p className={styles.details}>{details}</p>
        {onCancel && secondsLeft > 0 && (
          <Button variant="secondary" icon="undo-2" block onClick={onCancel}>
            {cancelLabel} · {secondsLeft} s
          </Button>
        )}
      </main>
      <footer className={styles.footer}>
        <div className={styles.track} data-progress aria-hidden="true">
          <div className={styles.bar} style={{ width: `${progress}%` }} />
        </div>
        <p role="timer" className={styles.timer}>
          Torno alla lettura delle card tra {secondsText(secondsLeft)}
        </p>
        <ButtonLink to="/" replace block>
          Leggi un’altra card
        </ButtonLink>
        <Link to={`/clienti/${customerId}`} className={styles.customerLink}>
          Apri la scheda di {firstName(customerName)}
        </Link>
      </footer>
    </div>
  );
}
