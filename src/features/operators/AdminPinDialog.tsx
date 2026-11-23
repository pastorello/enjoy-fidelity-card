import { Dialog } from '../../shared/ui/Dialog';
import { useDevice } from '../identity/AuthProvider';
import { AdminPinStep } from './AdminPinStep';
import type { PinRefusal } from './types';

type AdminPinDialogProps = {
  open: boolean;
  /** What the PIN confirms, e.g. "Per riattivare Paolo, amministratore, dal tablet serve il tuo PIN." */
  question: string;
  /** Sends the action with the PIN: the refusal of the PIN to show, or null when the caller took over. */
  onPin: (pin: string) => Promise<PinRefusal | null>;
  /** "Annulla" or Esc: nothing is sent. */
  onClose: () => void;
};

/**
 * "Conferma con il PIN": the PIN step of an admin action on the till tablet in its own bottom
 * sheet (SPEC-operators Open Questions 11), opened once the action is confirmed (an admin invited
 * or reactivated). The cashier and the lock of the till come from the device identity.
 */
export function AdminPinDialog({ open, question, onPin, onClose }: AdminPinDialogProps) {
  const device = useDevice();
  return (
    <Dialog open={open} title="Conferma con il PIN" closeLabel="Annulla" onClose={onClose}>
      <AdminPinStep
        question={question}
        cashierName={device?.cashier?.name ?? ''}
        lockSeconds={device?.lockSecondsLeft ?? 0}
        onPin={onPin}
      />
    </Dialog>
  );
}
