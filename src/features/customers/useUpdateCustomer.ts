import { useNavigate } from 'react-router';
import { useCustomerService } from './CustomerServiceProvider';
import { useCustomerSubmit, type CustomerSubmit } from './useCustomerSubmit';

/**
 * Saves the changes to a customer (SPEC-customers, point 7) and opens their page, replacing
 * Modifica cliente in the history. The update is idempotent, so "Riprova" just sends it again. A
 * customer erased meanwhile is not edited: the page shows "Cliente cancellato" instead.
 */
export function useUpdateCustomer(id: string): CustomerSubmit {
  const service = useCustomerService();
  const navigate = useNavigate();
  const openCustomer = () => {
    void navigate(`/clienti/${id}`, { replace: true });
  };

  return useCustomerSubmit({
    request: (values) =>
      service.update({ id, name: values.name, phone: values.phone, notes: values.notes }),
    onSaved: openCustomer,
    onRefused: (error) => {
      if (error.kind !== 'customer_anonymized') return false;
      openCustomer();
      return true;
    },
    networkText: 'Modifiche non salvate: controlla la connessione e riprova.',
  });
}
