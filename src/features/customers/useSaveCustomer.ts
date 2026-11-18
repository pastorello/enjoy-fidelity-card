import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { useCustomerService } from './CustomerServiceProvider';
import type { CreateCustomerInput, CustomerSummary } from './types';
import { useCustomerSubmit, type CustomerSubmit } from './useCustomerSubmit';

export type SaveCustomer = CustomerSubmit;

/** How another module saves the new customer instead (cards: with the card read). */
export type SaveCustomerVia = {
  /** Creates the customer; called with the same `operationId` as `CustomerService.create` would be. */
  create: (input: CreateCustomerInput) => Promise<CustomerSummary>;
  /** Where the new customer opens (replacing Nuovo cliente). */
  destination: (customer: CustomerSummary) => string;
  /** A rejection of `create` that is not a `CustomerError`, handled by the caller (true). */
  onOtherError?: (error: unknown) => boolean;
};

/**
 * Saves a new customer (SPEC-customers, points 4 and 5) and opens their page, replacing Nuovo
 * cliente in the history. The `operation_id` is generated on the first send and kept while the
 * outcome is unknown, so "Riprova" after a lost answer returns the customer already created;
 * a definite outcome (saved or refused) makes the next send a new operation. With `via`, another
 * module creates the customer (cards, with the card read) under the same `operation_id`.
 */
export function useSaveCustomer(via: SaveCustomerVia | null = null): SaveCustomer {
  const service = useCustomerService();
  const navigate = useNavigate();
  const operationId = useRef<string | null>(null);
  // Where the customer of the send in progress opens: the way it was created decides it.
  const destination = useRef<SaveCustomerVia['destination'] | null>(null);

  return useCustomerSubmit({
    request: (values) => {
      operationId.current ??= crypto.randomUUID();
      destination.current = via?.destination ?? null;
      const create = via ? via.create : (input: CreateCustomerInput) => service.create(input);
      return create({
        operationId: operationId.current,
        name: values.name,
        phone: values.phone,
        privacyConsent: values.privacyConsent,
        notes: values.notes,
      });
    },
    onSettled: () => {
      operationId.current = null;
    },
    // The operation_id is kept: nothing was created, so the next send may reuse it.
    onOtherError: (error) => via?.onOtherError?.(error) ?? false,
    onSaved: (customer) => {
      const to = destination.current?.(customer) ?? `/clienti/${customer.id}`;
      void navigate(to, { replace: true });
    },
    networkText: 'Cliente non salvato: controlla la connessione e riprova.',
  });
}
