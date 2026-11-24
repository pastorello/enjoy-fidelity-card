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
import { TabletColumns } from '../tablet-kiosk/TabletColumns';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import styles from './NewCustomerPage.module.css';
import { useSaveCustomer } from './useSaveCustomer';

const FORM_ID = 'new-customer';

/**
 * Nuovo cliente (`/clienti/nuovo`, `?nome=` optional; wireframes Nuovo cliente senza card and Nome
 * già usato): the form, checked in the app, and "Salva cliente" in the footer, busy while sending.
 * When the outcome is unknown the footer offers "Riprova", which sends the same operation again.
 * With the card of the home in the history state (wireframe Card sconosciuta: nuovo cliente,
 * SPEC-cards point 2; never `?card=`, SPEC-customers-v2 point 6) the card read is shown above the
 * form and saved with the customer. With a card (from the home or read here) the link is written
 * on it after the save, then Registra spesa (card from the home) or the customer opens.
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
  const tablet = useTabletLayout();

  if (card.saved !== null) return <NewCustomerCardLink saved={card.saved} />;

  const saveButton = (
    <Button
      type="submit"
      form={FORM_ID}
      block={!tablet}
      busy={busy}
      className={tablet ? styles.tabletSave : undefined}
    >
      {failure?.uncertain ? 'Riprova' : 'Salva cliente'}
    </Button>
  );
  // From the home: the card read, or the notice that it is someone else's (SPEC-cards, point 2).
  const linkCard =
    fromLink &&
    (card.taken ? (
      <CardTakenNotice owner={card.taken.owner}>
        <Button variant="secondary" block onClick={card.continueWithoutCard}>
          Continua senza card
        </Button>
      </CardTakenNotice>
    ) : (
      card.uid !== null && <NewCustomerCardPanel uid={card.uid} />
    ));
  const form = (
    <CustomerForm
      id={FORM_ID}
      withPrivacy
      initialValues={{ name: initialName }}
      onSubmit={save}
      refusal={refusal}
    />
  );

  if (tablet) {
    // Wireframe "Tablet: nuovo cliente" (SPEC-tablet-kiosk, point 10): the form and "Salva
    // cliente" on the left, away from the bottom edge; the card in the 440 px column.
    return (
      <AppShell title="Nuovo cliente" backTo="/">
        <TabletColumns
          column="card"
          width={440}
          centered
          aside={
            <>
              {linkCard}
              <NewCustomerCardBelowForm card={card} />
            </>
          }
        >
          <div className={styles.tabletForm}>
            {form}
            {failure && <SaveFailure text={failure.text} />}
            {saveButton}
            {fromLink && !card.taken && <RegisteredCustomerHint />}
          </div>
        </TabletColumns>
      </AppShell>
    );
  }

  return (
    <AppShell title="Nuovo cliente" backTo="/" actions={saveButton}>
      {linkCard}
      {form}
      <NewCustomerCardBelowForm card={card} />
      {failure && <SaveFailure text={failure.text} />}
      {fromLink && !card.taken && <RegisteredCustomerHint />}
    </AppShell>
  );
}
