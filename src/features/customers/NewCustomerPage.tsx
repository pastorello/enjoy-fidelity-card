import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Button } from '../../shared/ui/Button';
import { CustomerForm, nameFromQuery } from './CustomerForm';
import { SaveFailure } from './SaveFailure';
import { useSaveCustomer } from './useSaveCustomer';

const FORM_ID = 'new-customer';

/**
 * Nuovo cliente (`/clienti/nuovo`, `?nome=` optional; wireframes Nuovo cliente senza card and Nome
 * già usato): the form, checked in the app, and "Salva cliente" in the footer, busy while sending.
 * When the outcome is unknown the footer offers "Riprova", which sends the same operation again.
 */
export function NewCustomerPage() {
  const [searchParams] = useSearchParams();
  const [initialName] = useState(() => nameFromQuery(searchParams.get('nome')));
  const { save, busy, refusal, failure } = useSaveCustomer();

  return (
    <AppShell
      title="Nuovo cliente"
      backTo="/"
      actions={
        <Button type="submit" form={FORM_ID} block busy={busy}>
          {failure?.uncertain ? 'Riprova' : 'Salva cliente'}
        </Button>
      }
    >
      <CustomerForm
        id={FORM_ID}
        withPrivacy
        initialValues={{ name: initialName }}
        onSubmit={save}
        refusal={refusal}
      />
      {failure && <SaveFailure text={failure.text} />}
    </AppShell>
  );
}
