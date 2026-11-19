import { useCallback, useRef, useState } from 'react';
import { ServerFaultError } from '../../lib/serverFault';
import { useLatest } from '../../lib/useLatest';
import type { CustomerFormValues, CustomerRefusal } from './CustomerForm';
import { customerErrorField, customerErrorText } from './errorCodes';
import { CustomerError, type CustomerSummary } from './types';
import { useNotOperator } from './useNotOperator';

/**
 * Why the outcome of a call is unknown (a server fault, or `networkText` for anything else): the
 * page offers to try again, which is safe because every customers write is idempotent.
 */
export function failureText(error: unknown, networkText: string): string {
  if (error instanceof ServerFaultError) {
    return error.kind === 'misconfigured'
      ? 'Servizio non configurato: chiedi a un amministratore.'
      : 'Servizio momentaneamente non disponibile: riprova tra poco.';
  }
  return networkText;
}

export type CustomerSubmit = {
  /** Sends the form; ignored while a send is in progress (double tap, Enter). */
  save: (values: CustomerFormValues) => void;
  busy: boolean;
  /** The server refused the form: shown under its field. */
  refusal: CustomerRefusal | null;
  /**
   * What went wrong outside the fields. `uncertain`: the outcome is unknown (network, server
   * fault) and the page offers "Riprova", which is safe because the save is idempotent.
   */
  failure: { text: string; uncertain: boolean } | null;
};

export type CustomerSubmitOptions = {
  /** The call to the server. */
  request: (values: CustomerFormValues) => Promise<CustomerSummary>;
  /** Saved: where to go (the page stays busy until it is left). */
  onSaved: (customer: CustomerSummary) => void;
  /** The outcome is known (saved or refused): a create forgets its `operation_id`. */
  onSettled?: () => void;
  /** A refusal the page handles itself (returns true), before the usual messages. */
  onRefused?: (error: CustomerError) => boolean;
  /**
   * A rejection that is not a `CustomerError` (e.g. `card_taken` of a create with the card) the page
   * handles itself (returns true): nothing else happens, `onSettled` included. Otherwise it is an
   * unknown outcome.
   */
  onOtherError?: (error: unknown) => boolean;
  /** "Cliente non salvato…" or "Modifiche non salvate…". */
  networkText: string;
};

/**
 * Sends a customer form (SPEC-customers, points 5 and 7): busy while sending, the server's
 * refusals under their field, `not_operator` back to /accedi, and an unknown outcome as a failure
 * with "Riprova".
 */
export function useCustomerSubmit(options: CustomerSubmitOptions): CustomerSubmit {
  const notOperator = useNotOperator();
  // The callbacks of the screen on show, so `save` keeps its identity (see `useLatest`).
  const latest = useLatest(options);
  // Set synchronously, so a second tap in the same frame is ignored before `busy` renders.
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<CustomerRefusal | null>(null);
  const [failure, setFailure] = useState<CustomerSubmit['failure']>(null);

  const send = useCallback(
    async (values: CustomerFormValues) => {
      const { request, onSaved, onSettled, onRefused, onOtherError, networkText } = latest.current;
      try {
        const customer = await request(values);
        onSettled?.();
        onSaved(customer);
        return;
      } catch (error) {
        const refused =
          error instanceof CustomerError && error.kind !== 'network' && error.kind !== 'unknown';
        if (!(error instanceof CustomerError) && onOtherError?.(error)) {
          // Handled by the page.
        } else if (!refused) {
          setFailure({ text: failureText(error, networkText), uncertain: true });
        } else {
          onSettled?.();
          if (onRefused?.(error)) return;
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
    [notOperator, latest],
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
