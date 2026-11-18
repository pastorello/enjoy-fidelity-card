import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { useCustomerService } from './CustomerServiceProvider';
import { useCustomerSubmit, type CustomerSubmit } from './useCustomerSubmit';

export type SaveCustomer = CustomerSubmit;

/**
 * Saves a new customer (SPEC-customers, points 4 and 5) and opens their page, replacing Nuovo
 * cliente in the history. The `operation_id` is generated on the first send and kept while the
 * outcome is unknown, so "Riprova" after a lost answer returns the customer already created;
 * a definite outcome (saved or refused) makes the next send a new operation.
 */
export function useSaveCustomer(): SaveCustomer {
  const service = useCustomerService();
  const navigate = useNavigate();
  const operationId = useRef<string | null>(null);

  return useCustomerSubmit({
    request: (values) => {
      operationId.current ??= crypto.randomUUID();
      return service.create({
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
    onSaved: (customer) => {
      void navigate(`/clienti/${customer.id}`, { replace: true });
    },
    networkText: 'Cliente non salvato: controlla la connessione e riprova.',
  });
}
