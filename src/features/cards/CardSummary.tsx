import { Icon } from '../../shared/ui/Icon';
import styles from './CardSummary.module.css';
import { formatCardLabel } from './formatCard';
import { useActiveCard } from './useActiveCard';

/** «Card attiva …E5F6», «Senza card» or «Card non caricata»; null while the card is loading. */
function cardPart(load: ReturnType<typeof useActiveCard>): string | null {
  if (load.status === 'loading') return null;
  if (load.status === 'error') return 'Card non caricata';
  return load.card === null ? 'Senza card' : `Card attiva ${formatCardLabel(load.card.uid)}`;
}

/**
 * The line under the name of Scheda cliente (SPEC-cards point 6, SPEC-customers-v2 point 2): the
 * card part, « · » and the email in full («rossi@example.com») or «Senza email», in muted
 * secondary text. The email is plain selectable text, never a `mailto:` link: the app does not
 * write to customers. Until the card arrives only the email part shows, so the line never
 * guesses. Not mounted for an erased customer, whose line stays that of `customers`.
 */
export function CardSummary({ customerId, email }: { customerId: string; email: string | null }) {
  const card = cardPart(useActiveCard(customerId));
  const contact = email ?? 'Senza email';
  return (
    <p className={styles.summary}>
      <Icon name="credit-card" size={20} className={styles.icon} />
      {card === null ? contact : `${card} · ${contact}`}
    </p>
  );
}
