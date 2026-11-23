import { useRef, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';
import { Dialog } from './Dialog';
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

/** A question on the `Dialog` shell: the button that repeats the action, then the safe choice. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Lascia com’è',
  tone = 'primary',
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      closeLabel={cancelLabel}
      // A dangerous action starts on the safe choice (the shell's close action).
      initialFocusRef={tone === 'danger' ? undefined : confirmRef}
      onClose={onCancel}
    >
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
    </Dialog>
  );
}
