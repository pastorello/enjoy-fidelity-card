import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';
import { Icon } from './Icon';

type ConfirmDialogProps = {
  open: boolean;
  /**
   * A question: "Annullare la spesa di 12,50 €?". Set in Enjoy Display: a part with a glyph it lacks
   * (a card label "…E5F6", a typed name) goes in a span set in the body font.
   */
  title: ReactNode;
  /** The consequence, in one sentence. */
  description: ReactNode;
  /** Repeats the action: "Annulla la spesa". */
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" for actions that cannot be undone. */
  tone?: 'primary' | 'danger';
  /** The confirmed action is running: further presses are ignored. */
  busy?: boolean;
  /** Why the confirmed action failed (network, say): the dialog stays open to try again. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, ...props }: ConfirmDialogProps) {
  return open ? <OpenDialog {...props} /> : null;
}

function OpenDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Lascia com’è',
  tone = 'primary',
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: Omit<ConfirmDialogProps, 'open'>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    // A dangerous action starts on the safe choice.
    (tone === 'danger' ? cancelRef : confirmRef).current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, [tone]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Esc: let React close it, so state and focus stay in sync.
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <p id={descriptionId} className={styles.description}>
        {description}
      </p>
      {error !== null && error !== '' && (
        <p role="alert" className={styles.error}>
          <Icon name="circle-alert" size={24} className={styles.errorIcon} />
          {error}
        </p>
      )}
      <Button
        ref={confirmRef}
        variant={tone === 'danger' ? 'danger' : 'primary'}
        busy={busy}
        block
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
      <Button ref={cancelRef} variant="secondary" block onClick={onCancel}>
        {cancelLabel}
      </Button>
    </dialog>
  );
}
