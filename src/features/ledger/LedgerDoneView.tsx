import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatInteger } from '../../shared/format';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { vibrate } from '../card-input/vibrate';
import { firstName } from '../cards/customerName';
import styles from './LedgerDoneView.module.css';
import { LedgerError, type LedgerResult } from './types';
import type { Operation } from './useOperation';

/** Seconds before going back to the card reading, and of the "Annulla" window (SPEC-ledger, 3). */
export const RETURN_AFTER_SECONDS = 10;
/** After a refused cancellation the return starts again from here (SPEC-ledger, 3). */
export const RETURN_AFTER_REFUSAL_SECONDS = 3;

const RETRY_TEXT = 'Annullamento non riuscito: controlla la connessione e riprova.';

/**
 * Why the server refused the cancellation for good. Only the time out has a text in the spec;
 * "Punti già spesi" is the one of Movimenti; any other refusal (which the server gives only
 * to a movement already cancelled or not the operator's own) points to an administrator too.
 */
function refusalText(error: unknown): string {
  const kind = error instanceof LedgerError ? error.kind : null;
  if (kind === 'cancel-window-expired') {
    return 'Tempo scaduto: per annullare ora serve un amministratore.';
  }
  if (kind === 'insufficient-balance') {
    return 'Punti già spesi: questa spesa non si può più annullare.';
  }
  return 'Annullamento non riuscito: per annullare ora serve un amministratore.';
}

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
  /** "Spesa annullata" / "Riscatto annullato": the title once the cancellation is recorded. */
  cancelledTitle: string;
  /**
   * The cancellation of the movement (`useOperation` over `cancelMovement`), owned by the page
   * so it can react to `forbidden`. Without it the "Annulla" button is not shown.
   */
  cancel?: Operation<LedgerResult> | undefined;
};

function secondsText(seconds: number): string {
  return seconds === 1 ? '1 secondo' : `${seconds} secondi`;
}

/**
 * The confirmation of a movement just recorded (wireframes "Spesa registrata" and "Premio
 * riscattato"): no header, the check, the title (focused), NUOVO SALDO, a vibration where the
 * device has one, "Annulla" for 10 s, then back to `/` replacing the entry, so the system back
 * never returns to the keypad. "Annulla" (one tap, no dialog) stops the countdown while it is
 * sent: once recorded the title becomes "Spesa annullata" with the server's balance and there is
 * no automatic return; a refusal explains itself and the return starts again from 3 s; a network
 * error keeps the countdown stopped and offers "Riprova" with the same operation id.
 */
export function LedgerDoneView({
  title,
  summary,
  balance,
  details,
  customerId,
  customerName,
  cancelLabel,
  cancelledTitle,
  cancel,
}: LedgerDoneViewProps) {
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const vibrated = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(RETURN_AFTER_SECONDS);
  const [countdownFrom, setCountdownFrom] = useState(RETURN_AFTER_SECONDS);
  // Once the cancellation failed on the network, "Riprova" takes the place of "Annulla".
  const [failed, setFailed] = useState(false);

  const status = cancel?.status ?? 'idle';
  const refused = cancel?.status === 'error' && !cancel.retryable;
  const cancelled = cancel?.status === 'done' ? cancel.result : null;

  // Adjusted while rendering, when the cancellation changes state (no effect, no extra frame).
  const [seenStatus, setSeenStatus] = useState(status);
  if (status !== seenStatus) {
    setSeenStatus(status);
    if (cancel?.status === 'error' && cancel.retryable) setFailed(true);
    if (refused) {
      setFailed(false);
      setSecondsLeft(RETURN_AFTER_REFUSAL_SECONDS);
      setCountdownFrom(RETURN_AFTER_REFUSAL_SECONDS);
    }
  }

  // Stopped while the cancellation is sent, after a network error and once it is recorded.
  const counting = status === 'idle' || refused;

  useEffect(() => {
    heading.current?.focus();
    if (vibrated.current) return;
    vibrated.current = true;
    vibrate(200);
  }, []);

  // The title becomes "Spesa annullata": the focus goes back to it, so it is read.
  useEffect(() => {
    if (cancelled) heading.current?.focus();
  }, [cancelled]);

  // One tick a second while counting, cleared when it stops or the view goes away.
  useEffect(() => {
    const timer = counting
      ? setInterval(() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)), 1000)
      : undefined;
    return () => clearInterval(timer);
  }, [counting]);

  useEffect(() => {
    if (counting && secondsLeft === 0) void navigate('/', { replace: true });
  }, [counting, secondsLeft, navigate]);

  const progress = (secondsLeft / countdownFrom) * 100;
  const canCancel = cancel !== undefined && !cancelled && !refused && secondsLeft > 0;

  return (
    <div className={styles.screen}>
      <main className={styles.main}>
        <span className={styles.check}>
          <Icon name={cancelled ? 'undo-2' : 'check'} size={48} />
        </span>
        <h1 ref={heading} tabIndex={-1} className={styles.title}>
          {cancelled ? cancelledTitle : title}
        </h1>
        {cancelled ? (
          <p className={styles.summary}>
            <del className={styles.cancelled}>{summary}</del>
          </p>
        ) : (
          <p className={styles.summary}>{summary}</p>
        )}
        <section aria-label="Nuovo saldo" className={styles.balance}>
          <span className={styles.balanceLabel}>NUOVO SALDO</span>
          <p className={styles.balanceValue}>
            <BalanceFigure balance={cancelled ? cancelled.balance : balance} />
          </p>
        </section>
        <p className={styles.details}>{details}</p>
        {!cancelled && (failed || refused) && (
          <p role="alert" className={styles.failure}>
            {refused ? refusalText(cancel.error) : RETRY_TEXT}
          </p>
        )}
        {canCancel && failed && (
          <Button variant="secondary" block busy={status === 'busy'} onClick={cancel.retry}>
            Riprova
          </Button>
        )}
        {canCancel && !failed && (
          <Button
            variant="secondary"
            icon="undo-2"
            block
            busy={status === 'busy'}
            onClick={() => void cancel.submit()}
          >
            {cancelLabel} · {secondsLeft} s
          </Button>
        )}
      </main>
      <footer className={styles.footer}>
        {!cancelled && (
          <>
            <div className={styles.track} data-progress aria-hidden="true">
              <div className={styles.bar} style={{ width: `${progress}%` }} />
            </div>
            <p role="timer" className={styles.timer}>
              Torno alla lettura delle card tra {secondsText(secondsLeft)}
            </p>
          </>
        )}
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

function BalanceFigure({ balance }: { balance: number }) {
  return (
    <>
      <span className={styles.balanceFigure}>{formatInteger(balance)}</span>{' '}
      <span className={styles.balanceUnit}>{balance === 1 ? 'punto' : 'punti'}</span>
    </>
  );
}
