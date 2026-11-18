import { Link } from 'react-router';
import { Icon } from '../../shared/ui/Icon';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import type { CustomerSummary } from '../customers/types';
import styles from './CustomerRowLink.module.css';

/**
 * The customer row right under the header (wireframes "Associa o sostituisci card", "Registra spesa
 * (aperta dalla card)"): name, balance and an arrow, to the customer page.
 */
export function CustomerRowLink({ customer }: { customer: CustomerSummary }) {
  // The technical name of an erased customer is never shown.
  const name = customer.anonymizedAt === null ? customer.name : 'Cliente cancellato';
  return (
    <Link to={`/clienti/${customer.id}`} className={styles.customer}>
      <span className={styles.name}>{name}</span>
      <PointsBadge points={customer.balance} />
      <Icon name="chevron-right" size={20} className={styles.chevron} />
    </Link>
  );
}
