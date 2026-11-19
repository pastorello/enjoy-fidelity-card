import type { CardReaderState } from '../card-input/cardReader';
import { useCardReaderState } from '../card-input/useCardRead';
import { Icon } from '../../shared/ui/Icon';
import styles from './UsbReaderStatus.module.css';

const READY_TEXT = 'Lettore USB pronto';
const UNRECOGNIZED_TEXT =
  'Codice non riconosciuto: controlla il formato del lettore in Impostazioni';

/** Whether the last USB read gave no uid in the saved format (SPEC-tablet-kiosk, point 8). */
function lastReadInvalid({ lastReadAt, lastInvalidAt }: CardReaderState['usb']): boolean {
  return lastInvalidAt !== null && (lastReadAt === null || lastInvalidAt > lastReadAt);
}

/**
 * The USB reader indicator as a pure view of the reader state. A keyboard-wedge reader cannot be
 * detected, so "pronto" means the app listens for it (Open Questions 7); while the reader is off
 * (settings not loaded yet) the live region is there but says nothing, so it never claims a reader
 * that would not be heard.
 */
export function UsbReaderStatusView({ usb }: { usb: CardReaderState['usb'] }) {
  const invalid = lastReadInvalid(usb);
  return (
    <output
      aria-label="Stato del lettore USB"
      className={styles.status}
      data-invalid={invalid || undefined}
    >
      {usb.enabled && (
        <>
          <Icon name={invalid ? 'circle-alert' : 'check'} size={20} className={styles.icon} />
          {invalid ? UNRECOGNIZED_TEXT : READY_TEXT}
        </>
      )}
    </output>
  );
}

/** "Lettore USB pronto" / "Codice non riconosciuto…" in the reader column of Cerca on the tablet. */
export function UsbReaderStatus() {
  const { usb } = useCardReaderState();
  return <UsbReaderStatusView usb={usb} />;
}
