import { useState } from 'react';
import { Icon } from '../../shared/ui/Icon';
import { NOT_IN_DISPLAY } from '../cards/customerName';
import { PinPad } from '../tablet-kiosk/PinPad';
import { lockText, usePinLock, wrongPinText } from '../tablet-kiosk/pinLock';
import styles from './AdminPinStep.module.css';
import type { PinRefusal } from './types';

type AdminPinStepProps = {
  /** What the PIN confirms, e.g. "Per rendere Luca amministratore dal tablet serve il tuo PIN." */
  question: string;
  /** The cashier, who types their own PIN ("PIN di Giulia", as on /cassa). */
  cashierName: string;
  /** Seconds the lock of the till still lasts, as the identity says (0: none). */
  lockSeconds: number;
  /**
   * Sends the action with the PIN. Resolves with the refusal of the PIN to show here, or null
   * when the caller took over (done, or another answer it shows itself).
   */
  onPin: (pin: string) => Promise<PinRefusal | null>;
};

/**
 * The PIN step of an admin action on the till tablet (SPEC-operators Open Questions 11): inviting,
 * naming or reactivating an administrator from a device asks the cashier's PIN again, checked by
 * the server in the same request as the action. The PinPad of /cassa, sent once at the 4th digit;
 * a wrong PIN and the lock of the till (the same counter as /cassa) read as there. The PIN lives
 * only in this component's state and is cleared after every answer.
 */
export function AdminPinStep({ question, cashierName, lockSeconds, onPin }: AdminPinStepProps) {
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const { secondsLeft, lockFor } = usePinLock(lockSeconds);
  const locked = secondsLeft > 0;

  async function check(entered: string) {
    setChecking(true);
    setAttemptsLeft(null);
    let refusal: PinRefusal | null = null;
    try {
      refusal = await onPin(entered);
    } finally {
      setPin('');
      setChecking(false);
    }
    if (refusal?.status === 'wrong-pin') setAttemptsLeft(refusal.attemptsLeft);
    else if (refusal?.status === 'pin-locked') lockFor(refusal.lockSecondsLeft);
  }

  return (
    <div className={styles.step}>
      <p className={styles.question}>{question}</p>
      <PinPad
        heading={
          <h3 className={styles.pinTitle} data-body-font={NOT_IN_DISPLAY.test(cashierName)}>
            PIN di {cashierName}
          </h3>
        }
        value={pin}
        onChange={setPin}
        onComplete={(entered) => void check(entered)}
        disabled={checking || locked}
      />
      {locked ? (
        <p role="timer" className={styles.message}>
          {lockText(secondsLeft)}
        </p>
      ) : (
        attemptsLeft !== null && (
          <p role="alert" className={styles.message}>
            <Icon name="circle-alert" size={20} />
            {wrongPinText(attemptsLeft)}
          </p>
        )
      )}
      <p className={styles.note}>Dopo 5 PIN errati il tablet si blocca per qualche minuto.</p>
    </div>
  );
}
