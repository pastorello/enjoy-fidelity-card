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
 * The line under the name of Scheda cliente (SPEC-cards, point 6; wireframe "Scheda cliente"): the
 * card part, « · » and the phone part of `customers` («Tel. 333 ••• 4521» or «Senza telefono»), in
 * the muted secondary text of «Senza telefono». Until the card arrives only the phone part shows,
 * so the line never guesses. Not mounted for an erased customer, whose line stays that of
 * `customers`.
 */
export function CardSummary({ customerId, phone }: { customerId: string; phone: string }) {
  const card = cardPart(useActiveCard(customerId));
  return (
    <p className={styles.summary}>
      <Icon name="credit-card" size={20} className={styles.icon} />
      {card === null ? phone : `${card} · ${phone}`}
    </p>
  );
}
