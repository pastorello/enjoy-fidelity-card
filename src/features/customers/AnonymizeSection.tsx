import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { useCurrentOperator } from '../identity/AuthProvider';
import { useCustomerService } from './CustomerServiceProvider';
import { customerErrorText } from './errorCodes';
import { homeNoticeState } from './homeNotice';
import styles from './AnonymizeSection.module.css';
import { SaveFailure } from './SaveFailure';
import { CustomerError, type CustomerSummary } from './types';
import { failureText } from './useCustomerSubmit';
import { useNotOperator } from './useNotOperator';

const NETWORK_TEXT = 'Dati non cancellati: controlla la connessione e riprova.';
const DONE_TEXT = 'Dati del cliente cancellati.';

/**
 * DATI DEL CLIENTE on Modifica cliente (SPEC-customers, points 7 and 8), for administrators only:
 * "Cancella i dati del cliente" asks first with a danger `ConfirmDialog`, then anonymizes the
 * customer and opens the home (replace) with "Dati del cliente cancellati.". With no answer the
 * dialog stays open with the message, and confirming again is safe (the erase is idempotent); a
 * refusal (`forbidden`) closes it and is shown under the button.
 */
export function AnonymizeSection({ customer }: { customer: CustomerSummary }) {
  const { role } = useCurrentOperator();
  return role === 'admin' ? <AdminAnonymizeSection customer={customer} /> : null;
}

function AdminAnonymizeSection({ customer }: { customer: CustomerSummary }) {
  const service = useCustomerService();
  const navigate = useNavigate();
  const notOperator = useNotOperator();
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set synchronously, so a second tap in the same frame is ignored before `busy` renders.
  const sending = useRef(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function erase() {
    try {
      await service.anonymize(customer.id);
      // Busy until the page is left.
      void navigate('/', { replace: true, state: homeNoticeState(DONE_TEXT) });
      return;
    } catch (error) {
      if (error instanceof CustomerError && error.kind !== 'network' && error.kind !== 'unknown') {
        // A refusal: trying again would not help.
        if (!notOperator(error)) {
          setOpen(false);
          setRefusal(customerErrorText(error.kind));
        }
      } else {
        // The outcome is unknown (no answer, a server fault): the dialog stays open.
        setDialogError(failureText(error, NETWORK_TEXT));
      }
    }
    sending.current = false;
    setBusy(false);
  }

  function confirm() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setDialogError(null);
    void erase();
  }

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h2 id={headingId} className={styles.title}>
        DATI DEL CLIENTE
      </h2>
      <Button
        variant="danger-secondary"
        block
        onClick={() => {
          setRefusal(null);
          setDialogError(null);
          setOpen(true);
        }}
      >
        Cancella i dati del cliente
      </Button>
      <p className={styles.help}>
        Nome ed email si cancellano, i movimenti restano senza dati personali. Solo amministratori.
      </p>
      {refusal !== null && <SaveFailure text={refusal} />}
      <ConfirmDialog
        open={open}
        tone="danger"
        title={`Cancellare i dati di ${customer.name}?`}
        description="Nome, email e note si cancellano per sempre e la card si disattiva. I movimenti e il saldo restano, senza dati personali. Non si può tornare indietro."
        confirmLabel="Cancella i dati"
        busy={busy}
        error={dialogError}
        onConfirm={confirm}
        onCancel={() => {
          if (sending.current) return;
          setOpen(false);
          setDialogError(null);
        }}
      />
    </section>
  );
}
