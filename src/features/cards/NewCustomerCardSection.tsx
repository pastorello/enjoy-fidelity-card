import { CardReadPanel } from '../card-input/CardReadPanel';
import type { NfcStatus } from '../card-input/cardReader';
import { useCardReaderState } from '../card-input/useCardRead';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { CardTakenNotice } from './CardTakenNotice';
import { cardReadErrorText } from './homeCardNotice';
import { NewCustomerCardPanel } from './NewCustomerCardPanel';
import styles from './NewCustomerCardSection.module.css';
import type { NewCustomerCard, NewCustomerCardLookup } from './useNewCustomerCard';

const TITLE = 'Card (facoltativa)';
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
