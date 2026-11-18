import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { StatusView } from '../../shared/ui/StatusView';
import { CardReadPanel } from '../card-input/CardReadPanel';
import type { NfcStatus } from '../card-input/cardReader';
import { useCardReaderState } from '../card-input/useCardRead';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { loadErrorText } from '../customers/loadErrorText';
import { Associated, CardLinkScreen } from './CardLinkScreen';
import { CardTakenNotice } from './CardTakenNotice';
import { CustomerRowLink } from './CustomerRowLink';
import { shortName } from './formatCard';
import { cardReadErrorText } from './homeCardNotice';
import { NewCustomerCardPanel } from './NewCustomerCardPanel';
import styles from './NewCustomerCardSection.module.css';
import { useActiveCard } from './useActiveCard';
import type {
  NewCustomerCard,
  NewCustomerCardLookup,
  NewCustomerSaved,
} from './useNewCustomerCard';

const TITLE = 'Card (facoltativa)';
const NEW_CUSTOMER_TITLE = 'Nuovo cliente';
const TEXT =
  'Lettura attiva: avvicina una card nuova per associarla adesso, oppure fallo più tardi dalla scheda.';

/** Reading is on, or about to be: the section of the wireframe. Otherwise the reader's own states. */
const READING: ReadonlySet<NfcStatus> = new Set(['checking', 'starting', 'active']);

type NewCustomerCardSectionProps = {
  lookup: NewCustomerCardLookup;
  onRetry: () => void;
};

/**
 * "Card (facoltativa)" of Nuovo cliente senza card (SPEC-cards, point 3; wireframe "Nuovo cliente
 * senza card"): reading is on and a new card can be given now, or later from the customer page.
 * While a card is looked up it says so; a lookup without answer offers "Riprova". When reading is
 * not available (NFC off, permission, iPhone) the states of `CardReadPanel`: the customer is saved
 * without a card anyway.
 */
export function NewCustomerCardSection({ lookup, onRetry }: NewCustomerCardSectionProps) {
  const reader = useCardReaderState();
  if (!READING.has(reader.nfc)) {
    return (
      <section aria-label="Card">
        <CardReadPanel title={TITLE} description={TEXT} />
      </section>
    );
  }
  const starting = reader.nfc !== 'active';
  return (
    <section aria-label="Card" className={styles.section}>
      <Icon name="nfc" className={styles.icon} />
      <div className={styles.texts}>
        <p className={styles.title}>{TITLE}</p>
        {lookup.status === 'error' ? (
          <div role="alert" className={styles.error}>
            <p className={styles.text}>{cardReadErrorText(lookup.error)}</p>
            <Button variant="secondary" block onClick={onRetry}>
              Riprova
            </Button>
          </div>
        ) : (
          <p className={styles.text} aria-live="polite">
            {starting
              ? 'Avvio della lettura…'
              : lookup.status === 'reading'
                ? 'Lettura della card…'
                : TEXT}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * What follows the form of Nuovo cliente about the card (SPEC-cards, point 3): a lookup in progress
 * or without answer, over any earlier outcome; then, without `?card` (whose card and notice are above
 * the form, point 2), "Card già associata", the card read, or the section to read one.
 */
export function NewCustomerCardBelowForm({ card }: { card: NewCustomerCard }) {
  if (card.lookup.status !== 'idle') {
    return <NewCustomerCardSection lookup={card.lookup} onRetry={card.retryLookup} />;
  }
  if (card.source === 'link') return null;
  if (card.taken) return <CardTakenNotice owner={card.taken.owner} />;
  if (card.uid !== null) return <NewCustomerCardPanel uid={card.uid} />;
  return <NewCustomerCardSection lookup={card.lookup} onRetry={card.retryLookup} />;
}

/**
 * After «Salva cliente» with a card (SPEC-cards, points 2, 3 and 8): the link is written on the
 * card just saved (usually still on the phone), as in Associa card, then the destination opens in
 * place of Nuovo cliente — Registra spesa with `?card`, the customer page otherwise — with the link
 * written, after «Salta», «Più tardi», a failure, or on a phone that does not write: customer and
 * card stay saved either way. The card is loaded first (the save answers with the customer only);
 * without an answer, «Riprova» loads it again and «Più tardi» opens the destination. A card that is
 * not the one saved (changed meanwhile by another operator) is never written.
 */
export function NewCustomerCardLink({ saved }: { saved: NewCustomerSaved }) {
  const { customer, uid, destination } = saved;
  const navigate = useNavigate();
  const activeCard = useActiveCard(customer.id);
  const leave = useCallback(() => {
    void navigate(destination, { replace: true });
  }, [navigate, destination]);

  const card = activeCard.status === 'done' ? activeCard.card : null;
  const writable = card !== null && card.uid === uid;
  const notSaved = activeCard.status === 'done' && !writable;
  useEffect(() => {
    if (notSaved) leave();
  }, [notSaved, leave]);

  if (writable) {
    return (
      <CardLinkScreen
        title={NEW_CUSTOMER_TITLE}
        backTo={destination}
        customer={customer}
        card={card}
        intro={<Associated name={shortName(customer.name)} />}
        onLeave={leave}
      />
    );
  }

  return (
    <AppShell
      title={NEW_CUSTOMER_TITLE}
      backTo={destination}
      actions={
        activeCard.status === 'error' ? (
          <Button variant="secondary" block onClick={leave}>
            Più tardi
          </Button>
        ) : undefined
      }
    >
      <CustomerRowLink customer={customer} />
      {activeCard.status === 'error' ? (
        <StatusView
          kind="error"
          title="Link non scritto"
          description={loadErrorText(activeCard.error)}
          onRetry={activeCard.retry}
        />
      ) : (
        <StatusView kind="loading" />
      )}
    </AppShell>
  );
}
