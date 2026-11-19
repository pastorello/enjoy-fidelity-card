import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { useAuth, useCurrentOperator, useDevice } from '../identity/AuthProvider';
import { useKioskService } from './KioskServiceProvider';
import styles from './DisconnectTabletButton.module.css';

/**
 * "Disconnetti il tablet" in the account box of Impostazioni (SPEC-tablet-kiosk, point 12; Open
 * Questions 4), only on a device with an administrator at the till. After a danger confirmation
 * it ends the turn on the server, then signs the device account out and opens /accedi.
 *
 * The turn is ended first, whatever the answer: otherwise the cashier's turn (12 hours) would
 * still be open when the bar account signs in again, and the till would skip the PIN.
 */
export function DisconnectTabletButton() {
  const device = useDevice();
  const { role } = useCurrentOperator();
  return device && role === 'admin' ? <AdminDisconnect /> : null;
}

function AdminDisconnect() {
  const kiosk = useKioskService();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set synchronously, so a second tap in the same frame is ignored before `busy` renders.
  const leaving = useRef(false);

  async function disconnect() {
    await kiosk.endTurn().catch(() => undefined);
    await signOut();
    await navigate('/accedi', { replace: true });
  }

  return (
    <>
      <Button
        variant="danger-secondary"
        block
        className={styles.button}
        onClick={() => setOpen(true)}
      >
        Disconnetti il tablet
      </Button>
      <ConfirmDialog
        open={open}
        tone="danger"
        title="Disconnettere il tablet?"
        description="Per riaccedere servono email e password dell’account del bar."
        confirmLabel="Disconnetti il tablet"
        busy={busy}
        onConfirm={() => {
          if (leaving.current) return;
          leaving.current = true;
          setBusy(true);
          void disconnect();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
