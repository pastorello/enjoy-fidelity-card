import { useLocation, useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { formatDate, formatInteger } from '../../shared/format';
import { ButtonLink } from '../../shared/ui/Button';
import { StatusView } from '../../shared/ui/StatusView';
import styles from './CustomerPage.module.css';
import { customerBackTo } from './customerBack';
import { loadErrorText } from './loadErrorText';
import { formatPhoneForCard } from './phone';
import type { CustomerSummary } from './types';
import { useCustomer } from './useCustomer';

/** Title of the screen while there is no customer to name it. */
const PLACEHOLDER_TITLE = 'Scheda cliente';

/** SALDO (wireframe Scheda cliente): the label, the figure and "punti" on a cream block. */
function BalanceBox({ points }: { points: number }) {
  return (
    <section aria-labelledby="customer-balance" className={styles.balance}>
      <h2 id="customer-balance" className={styles.balanceLabel}>
        SALDO
      </h2>
      <p className={styles.balanceValue}>
        <span className={styles.balanceFigure}>{formatInteger(points)}</span>{' '}
        <span className={styles.balanceUnit}>{points === 1 ? 'punto' : 'punti'}</span>
      </p>
    </section>
  );
}

/**
 * The customer's details. The "Card attiva …E5F6 · " part of the first line belongs to `cards`,
 * and `ledger` mounts its `CustomerLedgerSection` (Registra spesa, Riscatta premio, ULTIMI
 * MOVIMENTI) below the SALDO block.
 */
function CustomerDetails({ customer }: { customer: CustomerSummary }) {
  if (customer.anonymizedAt !== null) {
    // The technical name of an erased customer is never shown, and there is nothing to edit.
    return (
      <>
        <p className={styles.meta}>Dati cancellati il {formatDate(customer.anonymizedAt)}</p>
        <BalanceBox points={customer.balance} />
      </>
    );
  }
  return (
    <>
      <p className={styles.meta}>
        {customer.phone === null ? 'Senza telefono' : `Tel. ${formatPhoneForCard(customer.phone)}`}
      </p>
      {customer.notes !== null && <p className={styles.notes}>{customer.notes}</p>}
      <BalanceBox points={customer.balance} />
    </>
  );
}

/**
 * Scheda cliente (`/clienti/:id`; wireframe Scheda cliente): the name as title with "Modifica
 * cliente", the phone, the notes and the balance. "Indietro" returns to the search it came from.
 * An id that is not a UUID is "Cliente non trovato" without asking the server.
 */
export function CustomerPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const backTo = customerBackTo(location.state);
  const load = useCustomer(id);

  if (load.status === 'done') {
    const { customer } = load;
    const erased = customer.anonymizedAt !== null;
    return (
      <AppShell
        title={erased ? 'Cliente cancellato' : customer.name}
        backTo={backTo}
        headerAction={
          erased
            ? undefined
            : { label: 'Modifica cliente', icon: 'pencil', to: `/clienti/${customer.id}/modifica` }
        }
      >
        <CustomerDetails customer={customer} />
      </AppShell>
    );
  }

  if (load.status === 'not-found') {
    return (
      <AppShell
        title={PLACEHOLDER_TITLE}
        backTo={backTo}
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
    <AppShell title={PLACEHOLDER_TITLE} backTo={backTo}>
      {load.status === 'loading' ? (
        <StatusView kind="loading" />
      ) : (
        <StatusView
          kind="error"
          title="Scheda non caricata"
          description={loadErrorText(load.error)}
          onRetry={load.retry}
        />
      )}
    </AppShell>
  );
}
