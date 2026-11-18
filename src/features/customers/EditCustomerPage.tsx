import { Navigate, useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { StatusView } from '../../shared/ui/StatusView';
import { CustomerForm } from './CustomerForm';
import { loadErrorText } from './loadErrorText';
import { formatPhoneForEdit } from './phone';
import { SaveFailure } from './SaveFailure';
import type { CustomerSummary } from './types';
import { useCustomer } from './useCustomer';
import { useUpdateCustomer } from './useUpdateCustomer';

const TITLE = 'Modifica cliente';
const FORM_ID = 'edit-customer';

/** The form, filled with the customer as saved, and "Salva modifiche" (or "Riprova") below. */
function EditForm({ customer }: { customer: CustomerSummary }) {
  const { save, busy, refusal, failure } = useUpdateCustomer(customer.id);
  return (
    <AppShell
      title={TITLE}
      backTo={`/clienti/${customer.id}`}
      actions={
        <Button type="submit" form={FORM_ID} block busy={busy}>
          {failure?.uncertain ? 'Riprova' : 'Salva modifiche'}
        </Button>
      }
    >
      <CustomerForm
        id={FORM_ID}
        withPrivacy={false}
        withHelp={false}
        initialValues={{
          name: customer.name,
          phone: customer.phone === null ? '' : formatPhoneForEdit(customer.phone),
          notes: customer.notes ?? '',
        }}
        onSubmit={save}
        refusal={refusal}
      />
      {failure && <SaveFailure text={failure.text} />}
    </AppShell>
  );
}

/**
 * Modifica cliente (`/clienti/:id/modifica`; wireframe Modifica cliente): name, phone and notes,
 * no PRIVACY section (the consent is given once). Loading, not found and error as on the
 * customer page; a customer whose data was erased is not edited: back to their page.
 */
export function EditCustomerPage() {
  const { id = '' } = useParams();
  const load = useCustomer(id);

  if (load.status === 'done') {
    const { customer } = load;
    if (customer.anonymizedAt !== null) {
      return <Navigate to={`/clienti/${customer.id}`} replace />;
    }
    return <EditForm key={customer.id} customer={customer} />;
  }

  const backTo = `/clienti/${id}`;
  if (load.status === 'not-found') {
    return (
      <AppShell
        title={TITLE}
        backTo="/"
        actions={
          <ButtonLink to="/" block>
            Torna all’inizio
          </ButtonLink>
        }
      >
        <StatusView
          kind="empty"
          icon="search"
          title="Cliente non trovato"
          description="Il collegamento potrebbe essere vecchio o scritto male."
        />
      </AppShell>
    );
  }

  return (
    <AppShell title={TITLE} backTo={backTo}>
      {load.status === 'loading' ? (
        <StatusView kind="loading" />
      ) : (
        <StatusView
          kind="error"
          title="Scheda non caricata"
          description={loadErrorText(load.error)}
          onRetry={load.retry}
        />
      )}
    </AppShell>
  );
}
