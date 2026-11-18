import { useId, type ReactNode } from 'react';
import { ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import styles from './CardTakenNotice.module.css';
import { firstName, NOT_IN_DISPLAY } from './customerName';
import type { CardOwner } from './types';

const ONE_CUSTOMER = 'Una card può essere di un solo cliente: usa un’altra card.';

/** Who the card belongs to, as the wireframe "Card già di un altro cliente" says it. */
function ownerText(owner: CardOwner | null): string {
  if (owner === null) return `Questa card è già di un altro cliente. ${ONE_CUSTOMER}`;
  if (owner.name === null) {
    return `Questa card era di un cliente i cui dati sono stati cancellati. ${ONE_CUSTOMER}`;
  }
  return `Questa card ${owner.active ? 'è' : 'era'} di ${owner.name}. ${ONE_CUSTOMER}`;
}

type CardTakenNoticeProps = {
  /** The owner `card_taken` named; null when the server did not say. */
  owner: CardOwner | null;
  /** The screen's own way out, before "Apri la scheda di …" (e.g. "Continua senza card"). */
  children?: ReactNode;
};

/**
 * "Card già associata" (SPEC-cards, point 4; wireframe "Card già di un altro cliente"): a uid
 * belongs to one customer forever. "Apri la scheda di …" only when the owner has a name: an erased
 * customer is never named nor opened.
 */
export function CardTakenNotice({ owner, children }: CardTakenNoticeProps) {
  const titleId = useId();
  const name = owner?.name ? firstName(owner.name) : null;
  return (
    <section role="alert" aria-labelledby={titleId} className={styles.notice}>
      <Icon name="circle-alert" size={48} className={styles.icon} />
      <h2 id={titleId} className={styles.title}>
        Card già associata
      </h2>
      <p className={styles.text}>{ownerText(owner)}</p>
      {(children !== undefined || (owner && name !== null)) && (
        <div className={styles.actions}>
          {children}
          {owner && name !== null && (
            <ButtonLink to={`/clienti/${owner.customerId}`} variant="secondary" block>
              Apri la scheda di{' '}
              <span className={NOT_IN_DISPLAY.test(name) ? styles.typedName : undefined}>
                {name}
              </span>
            </ButtonLink>
          )}
        </div>
      )}
    </section>
  );
}
