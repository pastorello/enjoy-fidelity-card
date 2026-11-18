import { useEffect, useId, useRef } from 'react';
import { Button } from '../../shared/ui/Button';
import styles from './PrivacyNoticeDialog.module.css';
import { PRIVACY_NOTICE_TEXT } from './privacyNotice';

type PrivacyNoticeDialogProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * The privacy notice in a bottom sheet, the same shape as `ConfirmDialog`: read only, one
 * "Chiudi" button, Esc closes it, the focus goes back to "Mostra l’informativa".
 */
export function PrivacyNoticeDialog({ open, onClose }: PrivacyNoticeDialogProps) {
  return open ? <OpenDialog onClose={onClose} /> : null;
}

function OpenDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={textId}
      onCancel={(event) => {
        // Esc: let React close it, so state and focus stay in sync.
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className={styles.title}>
        Informativa privacy
      </h2>
      <p id={textId} className={styles.text}>
        {PRIVACY_NOTICE_TEXT}
      </p>
      <Button ref={closeRef} variant="secondary" block onClick={onClose}>
        Chiudi
      </Button>
    </dialog>
  );
}
