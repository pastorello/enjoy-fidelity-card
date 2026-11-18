import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ServerFaultError } from '../../lib/serverFault';
import type { CustomerFormValues, CustomerRefusal } from './CustomerForm';
import { useCustomerService } from './CustomerServiceProvider';
import { customerErrorField, customerErrorText } from './errorCodes';
import { CustomerError } from './types';
import { useNotOperator } from './useNotOperator';

const NETWORK_TEXT = 'Cliente non salvato: controlla la connessione e riprova.';

/** Why the outcome of a save is unknown: the page offers "Riprova" with the same `operation_id`. */
function failureText(error: unknown): string {
  if (error instanceof ServerFaultError) {
    return error.kind === 'misconfigured'
      ? 'Servizio non configurato: chiedi a un amministratore.'
      : 'Servizio momentaneamente non disponibile: riprova tra poco.';
  }
  return NETWORK_TEXT;
}

export type SaveCustomer = {
  /** Sends the form; ignored while a send is in progress (double tap, Enter). */
  save: (values: CustomerFormValues) => void;
  busy: boolean;
  /** The server refused the form: shown under its field. */
  refusal: CustomerRefusal | null;
  /**
   * What went wrong outside the fields. `uncertain`: the outcome is unknown (network, server
   * fault) and the page offers "Riprova", which resends the same `operation_id`.
   */
  failure: { text: string; uncertain: boolean } | null;
};

/**
 * Saves a new customer (SPEC-customers, points 4 and 5) and opens their page, replacing Nuovo
 * cliente in the history. The `operation_id` is generated on the first send and kept while the
 * outcome is unknown, so "Riprova" after a lost answer returns the customer already created;
 * a refusal of the server (a definite outcome) makes the next send a new operation.
 */
export function useSaveCustomer(): SaveCustomer {
  const service = useCustomerService();
  const notOperator = useNotOperator();
  const navigate = useNavigate();
  const operationId = useRef<string | null>(null);
  // Set synchronously, so a second tap in the same frame is ignored before `busy` renders.
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<CustomerRefusal | null>(null);
  const [failure, setFailure] = useState<SaveCustomer['failure']>(null);

  const send = useCallback(
    async (values: CustomerFormValues) => {
      operationId.current ??= crypto.randomUUID();
      try {
        const customer = await service.create({
          operationId: operationId.current,
          name: values.name,
          phone: values.phone,
          privacyConsent: values.privacyConsent,
          notes: values.notes,
        });
        operationId.current = null;
        // Still busy until the page is left: nothing else can be sent meanwhile.
        void navigate(`/clienti/${customer.id}`, { replace: true });
        return;
      } catch (error) {
        const refused =
          error instanceof CustomerError && error.kind !== 'network' && error.kind !== 'unknown';
        if (!refused) {
          setFailure({ text: failureText(error), uncertain: true });
        } else {
          operationId.current = null;
          if (!notOperator(error)) {
            if (error.kind === 'customer_name_taken') {
              setRefusal({ kind: 'name_taken', existingCustomerId: error.existingCustomerId });
            } else {
              const field = customerErrorField(error.kind);
              const text = customerErrorText(error.kind);
              if (field) setRefusal({ kind: 'field', field, text });
              else setFailure({ text, uncertain: false });
            }
          }
        }
      }
      sending.current = false;
      setBusy(false);
    },
    [service, notOperator, navigate],
  );

  const save = useCallback(
    (values: CustomerFormValues) => {
      if (sending.current) return;
      sending.current = true;
      setBusy(true);
      setRefusal(null);
      setFailure(null);
      void send(values);
    },
    [send],
  );

  return { save, busy, refusal, failure };
}
