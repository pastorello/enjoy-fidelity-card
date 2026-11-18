import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Button } from '../../shared/ui/Button';
import { CardTakenNotice } from '../cards/CardTakenNotice';
import { NewCustomerCardPanel, RegisteredCustomerHint } from '../cards/NewCustomerCardPanel';
import { useNewCustomerCard } from '../cards/useNewCustomerCard';
import { CustomerForm, nameFromQuery } from './CustomerForm';
import { SaveFailure } from './SaveFailure';
import { useSaveCustomer } from './useSaveCustomer';

const FORM_ID = 'new-customer';

/**
 * Nuovo cliente (`/clienti/nuovo`, `?nome=` optional; wireframes Nuovo cliente senza card and Nome
 * già usato): the form, checked in the app, and "Salva cliente" in the footer, busy while sending.
 * When the outcome is unknown the footer offers "Riprova", which sends the same operation again.
 * With `?card=UID` (wireframe Card sconosciuta: nuovo cliente, SPEC-cards point 2) the card read
 * is shown above the form and saved with the customer, then Registra spesa opens.
 */
export function NewCustomerPage() {
  const [searchParams] = useSearchParams();
  const [initialName] = useState(() => nameFromQuery(searchParams.get('nome')));
  const card = useNewCustomerCard();
  const { save, busy, refusal, failure } = useSaveCustomer(card.via);

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
      {card.taken ? (
        <CardTakenNotice owner={card.taken.owner}>
          <Button variant="secondary" block onClick={card.continueWithoutCard}>
            Continua senza card
          </Button>
        </CardTakenNotice>
      ) : (
        card.uid !== null && <NewCustomerCardPanel uid={card.uid} />
      )}
      <CustomerForm
        id={FORM_ID}
        withPrivacy
        initialValues={{ name: initialName }}
        onSubmit={save}
        refusal={refusal}
      />
      {failure && <SaveFailure text={failure.text} />}
      {card.uid !== null && !card.taken && <RegisteredCustomerHint />}
    </AppShell>
  );
}
