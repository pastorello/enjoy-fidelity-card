import { useEffect } from 'react';
import { useLatest } from '../../lib/useLatest';
import { formatCents, formatInteger, formatTime } from '../../shared/format';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { failureText } from '../customers/useCustomerSubmit';
import { useAuth } from '../identity/AuthProvider';
import styles from './CancelMovementDialog.module.css';
import { formatMovementDate, formatSignedPoints } from './formatMovement';
import { useLedgerService } from './LedgerServiceProvider';
import { LedgerError, type Movement } from './types';
import { useOperation } from './useOperation';

const NETWORK_TEXT = 'Annullamento non riuscito: controlla la connessione e riprova.';

/**
 * How a cancellation ended for good: recorded; `already-cancelled` (another administrator was
 * quicker); `spent` (`insufficient-balance`: the purchase's points are spent meanwhile);
 * `forbidden` (no operator profile any more); `refused` (any other refusal).
 */
export type CancelOutcome = 'cancelled' | 'already-cancelled' | 'spent' | 'forbidden' | 'refused';

function pointsText(points: number): string {
  return `${formatSignedPoints(points)} ${Math.abs(points) === 1 ? 'punto' : 'punti'}`;
}

/** "Oggi alle 10:42", "Ieri alle 19:10", "8 nov alle 18:05". */
function whenText(iso: string): string {
  const time = formatTime(iso);
  const day = formatMovementDate(iso).slice(0, -time.length).trimEnd();
  return `${day} alle ${time}`;
}

function outcomeOf(error: unknown): CancelOutcome {
  const kind = error instanceof LedgerError ? error.kind : null;
  if (kind === 'already-cancelled') return 'already-cancelled';
  if (kind === 'insufficient-balance') return 'spent';
  if (kind === 'forbidden') return 'forbidden';
  return 'refused';
}

/**
 * The administrator's confirmation before cancelling a purchase or a redemption from Movimenti
 * (SPEC-ledger point 9): a danger `ConfirmDialog` that says what the correction does to the
 * balance. Confirming sends `cancelMovement` with an operation id of its own (`useOperation`):
 * with no answer the dialog stays open with the message and confirming again resends the same
 * id; while it is sent the dialog cannot be dismissed. Once recorded or refused for good it
 * reports `onSettled` (a `forbidden` refusal also goes to `reportNotEnabled`).
 */
export function CancelMovementDialog({
  movement,
  balance,
  onClose,
  onSettled,
}: {
  movement: Movement;
  /** The customer's balance now, for "il saldo passa da 20 a 8". */
  balance: number;
  /** "Lascia com’è" or Esc: nothing sent, or the uncertain id discarded. */
  onClose: () => void;
  onSettled: (outcome: CancelOutcome) => void;
}) {
  const service = useLedgerService();
  const { reportNotEnabled } = useAuth();
  const operation = useOperation((operationId) =>
    service.cancelMovement({ operationId, movementId: movement.id }),
  );
  const settled = useLatest(onSettled);

  let outcome: CancelOutcome | null = null;
  if (operation.status === 'done') outcome = 'cancelled';
  else if (operation.status === 'error' && !operation.retryable) {
    outcome = outcomeOf(operation.error);
  }

  useEffect(() => {
    if (outcome === null) return;
    if (outcome === 'forbidden') void reportNotEnabled();
    settled.current(outcome);
  }, [outcome, reportNotEnabled, settled]);

  const busy = operation.status === 'busy';
  const error =
    operation.status === 'error' && operation.retryable
      ? failureText(operation.error, NETWORK_TEXT)
      : null;
  const purchase = movement.kind === 'purchase';
  let title;
  if (purchase) {
    title =
      movement.amountCents === null
        ? 'Annullare la spesa?'
        : `Annullare la spesa di ${formatCents(movement.amountCents)}?`;
  } else if (movement.description === null) {
    title = 'Annullare il riscatto?';
  } else {
    // A reward's name is free text: set in the body font, Enjoy Display may lack its glyphs.
    title = (
      <>
        Annullare il riscatto di <span className={styles.name}>{movement.description}</span>?
      </>
    );
  }
  const description = `${whenText(movement.createdAt)}, ${pointsText(movement.points)}. Si registra una correzione di ${pointsText(-movement.points)} e il saldo passa da ${formatInteger(balance)} a ${formatInteger(balance - movement.points)}. Il movimento resta nello storico.`;

  return (
    <ConfirmDialog
      open
      tone="danger"
      title={title}
      description={description}
      confirmLabel={purchase ? 'Annulla la spesa' : 'Annulla il riscatto'}
      busy={busy}
      error={error}
      onConfirm={() => void operation.submit()}
      onCancel={() => {
        if (busy) return;
        operation.reset();
        onClose();
      }}
    />
  );
}
