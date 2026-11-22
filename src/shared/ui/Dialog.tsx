import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from './Button';
import styles from './Dialog.module.css';

type DialogProps = {
  open: boolean;
  /**
   * Names the dialog. Set in Enjoy Display: a part with a glyph it lacks (a card label "…E5F6", a
   * typed name) goes in a span set in the body font.
   */
  title: ReactNode;
  /** One sentence under the title that describes the dialog (`aria-describedby`). */
  description?: ReactNode;
  /** Between the description and the close action. */
  children: ReactNode;
  /** The last button, the safe choice: "Chiudi" unless the dialog asks a question. */
  closeLabel?: string;
  /** Where focus starts; "Chiudi" when not given. Read once, when the dialog opens. */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  /** "Chiudi" or Esc. */
  onClose: () => void;
};

/**
 * Bottom-sheet modal shell (design system "Azione pericolosa"): a modal `<dialog>` with a title, an
 * optional description, its content and a close action. Focus returns to the opener on close.
 */
export function Dialog({ open, ...props }: DialogProps) {
  return open ? <OpenDialog {...props} /> : null;
}

function OpenDialog({
  title,
  description,
  children,
  closeLabel = 'Chiudi',
  initialFocusRef,
  onClose,
}: Omit<DialogProps, 'open'>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hasDescription = description !== undefined && description !== null;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    (initialFocusRef?.current ?? closeRef.current)?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, [initialFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      onCancel={(event) => {
        // Esc: let React close it, so state and focus stay in sync.
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {hasDescription && (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
      {children}
      <Button ref={closeRef} variant="secondary" block onClick={onClose}>
        {closeLabel}
      </Button>
    </dialog>
  );
}
