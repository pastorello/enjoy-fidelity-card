import { useRef } from 'react';
import { Link, useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import { StatusView } from '../../shared/ui/StatusView';
import { loadErrorText } from '../customers/loadErrorText';
import { useCustomer } from '../customers/useCustomer';
import styles from './PurchasePlaceholderPage.module.css';

const TITLE = 'Registra spesa';

/**
 * `/clienti/:id/spesa` until `ledger` replaces it on the same route (SPEC-cards, point 1): the
 * header "Registra spesa" with "Indietro" to the home and the customer row (name and balance, to the
 * customer page) of the wireframe "Registra spesa (aperta dalla card)", no keypad.
 */
export function PurchasePlaceholderPage() {
  const { id = '' } = useParams();
  const load = useCustomer(id);
  const heading = useRef<HTMLHeadingElement>(null);

  function retry() {
    load.retry();
    heading.current?.focus();
  }

  if (load.status === 'done') {
    const { customer } = load;
    // The technical name of an erased customer is never shown.
    const name = customer.anonymizedAt === null ? customer.name : 'Cliente cancellato';
    return (
      <AppShell title={TITLE} backTo="/" headingRef={heading}>
        <Link to={`/clienti/${customer.id}`} className={styles.customer}>
          <span className={styles.name}>{name}</span>
          <PointsBadge points={customer.balance} />
          <Icon name="chevron-right" size={20} className={styles.chevron} />
        </Link>
      </AppShell>
    );
  }

  if (load.status === 'not-found') {
    return (
      <AppShell
        title={TITLE}
        backTo="/"
        headingRef={heading}
        actions={
          <ButtonLink to="/" block>
            Torna all’inizio
          </ButtonLink>
        }
      >
        <StatusView
          kind="empty"
          icon="search"
          title="Cliente non trovato"
          description="Il collegamento potrebbe essere vecchio o scritto male."
        />
      </AppShell>
    );
  }

  return (
    <AppShell title={TITLE} backTo="/" headingRef={heading}>
      {load.status === 'loading' ? (
        <StatusView kind="loading" />
      ) : (
        <StatusView
          kind="error"
          title="Cliente non caricato"
          description={loadErrorText(load.error)}
          onRetry={retry}
        />
      )}
    </AppShell>
  );
}
