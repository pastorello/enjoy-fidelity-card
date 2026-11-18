import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Button } from '../../shared/ui/Button';
import { useCardRead } from '../card-input/useCardRead';
import { CardTakenNotice } from '../cards/CardTakenNotice';
import { NewCustomerCardPanel, RegisteredCustomerHint } from '../cards/NewCustomerCardPanel';
import { NewCustomerCardBelowForm, NewCustomerCardLink } from '../cards/NewCustomerCardSection';
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
 * is shown above the form and saved with the customer. With a card (from `?card` or read here) the
 * link is written on it after the save, then Registra spesa (with `?card`) or the customer opens.
 */
export function NewCustomerPage() {
  const [searchParams] = useSearchParams();
  const [initialName] = useState(() => nameFromQuery(searchParams.get('nome')));
  const card = useNewCustomerCard();
  const { save, busy, refusal, failure } = useSaveCustomer(card.via);
  // Reads are off while saving, while a card is looked up, and once saved (the link is written).
  useCardRead((read) => card.read(read.uid), {
    enabled: !busy && card.lookup.status !== 'reading' && card.saved === null,
  });
  const fromLink = card.source === 'link';

  if (card.saved !== null) return <NewCustomerCardLink saved={card.saved} />;

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
      {fromLink &&
        (card.taken ? (
          <CardTakenNotice owner={card.taken.owner}>
            <Button variant="secondary" block onClick={card.continueWithoutCard}>
              Continua senza card
            </Button>
          </CardTakenNotice>
        ) : (
          card.uid !== null && <NewCustomerCardPanel uid={card.uid} />
        ))}
      <CustomerForm
        id={FORM_ID}
        withPrivacy
        initialValues={{ name: initialName }}
        onSubmit={save}
        refusal={refusal}
      />
      <NewCustomerCardBelowForm card={card} />
      {failure && <SaveFailure text={failure.text} />}
      {fromLink && !card.taken && <RegisteredCustomerHint />}
    </AppShell>
  );
}
