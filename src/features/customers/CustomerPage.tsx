import { useRef } from 'react';
import { useLocation, useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { formatDate, formatInteger } from '../../shared/format';
import { ButtonLink } from '../../shared/ui/Button';
import { StatusView } from '../../shared/ui/StatusView';
import { CardSummary } from '../cards/CardSummary';
import {
  CustomerLastMovements,
  CustomerLedgerActions,
  CustomerLedgerSection,
} from '../ledger/CustomerLedgerSection';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import styles from './CustomerPage.module.css';
import { customerBackHomeState } from './customerBack';
import { loadErrorText } from './loadErrorText';
import { NavigationNotice } from './NavigationNotice';
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

/** The lines under the title: the card and the email, the notes, or "Dati cancellati il …". */
function CustomerLines({ customer }: { customer: CustomerSummary }) {
  if (customer.anonymizedAt !== null) {
    // The technical name of an erased customer is never shown, and there is nothing to edit.
    return <p className={styles.meta}>Dati cancellati il {formatDate(customer.anonymizedAt)}</p>;
  }
  return (
    <>
      <CardSummary customerId={customer.id} email={customer.email} />
      {customer.notes !== null && <p className={styles.notes}>{customer.notes}</p>}
    </>
  );
}

/**
 * The customer's details. The first line is `cards`' CardSummary ("Card attiva …E5F6 · ") with the
 * customer's email or "Senza email"; `ledger` mounts its `CustomerLedgerSection` (Registra spesa, Riscatta premio, ULTIMI
 * MOVIMENTI) below the SALDO block.
 */
function CustomerDetails({ customer }: { customer: CustomerSummary }) {
  return (
    <>
      <NavigationNotice />
      <CustomerLines customer={customer} />
      <BalanceBox points={customer.balance} />
      <CustomerLedgerSection customer={customer} />
    </>
  );
}

/**
 * The same details at 1280×800 (wireframe "Tablet: scheda cliente", SPEC-tablet-kiosk point 10):
 * the lines, SALDO and the actions in a 560 px column on the left, near the top and far from the
 * bottom edge; ULTIMI MOVIMENTI on the right.
 */
function TabletCustomerDetails({ customer }: { customer: CustomerSummary }) {
  return (
    <div className={styles.tabletLayout} data-tablet="true">
      <div className={styles.customerColumn} data-tablet-column="customer">
        <NavigationNotice />
        <CustomerLines customer={customer} />
        <BalanceBox points={customer.balance} />
        <CustomerLedgerActions customer={customer} />
      </div>
      <div className={styles.movementsColumn} data-tablet-column="movements">
        <CustomerLastMovements customer={customer} />
      </div>
    </div>
  );
}

/**
 * Scheda cliente (`/clienti/:id`; wireframe Scheda cliente): the name as title with "Modifica
 * cliente", the email, the notes and the balance. "Indietro" returns to the search it came from.
 * An id that is not a UUID is "Cliente non trovato" without asking the server. A one-time message
 * of the navigation state ("Card …A1B2 associata.") opens the page.
 */
export function CustomerPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  // Always the home; the search it came from travels in the history state, never in the URL.
  const backState = customerBackHomeState(location.state);
  const load = useCustomer(id);
  // 1280×800: SALDO and the actions on the left, ULTIMI MOVIMENTI on the right.
  const tablet = useTabletLayout();
  // Every branch renders the same AppShell, so its h1 stays mounted through loading and errors.
  const heading = useRef<HTMLHeadingElement>(null);

  // "Riprova" is replaced by the loading state: the focus goes to the title, not to <body>.
  function retry() {
    load.retry();
    heading.current?.focus();
  }

  if (load.status === 'done') {
    const { customer } = load;
    const erased = customer.anonymizedAt !== null;
    return (
      <AppShell
        title={erased ? 'Cliente cancellato' : customer.name}
        backTo="/"
        backState={backState}
        headingRef={heading}
        repeatCutTitle={!erased}
        headerAction={
          erased
            ? undefined
            : { label: 'Modifica cliente', icon: 'pencil', to: `/clienti/${customer.id}/modifica` }
        }
      >
        {tablet ? (
          <TabletCustomerDetails customer={customer} />
        ) : (
          <CustomerDetails customer={customer} />
        )}
      </AppShell>
    );
  }

  if (load.status === 'not-found') {
    return (
      <AppShell
        title={PLACEHOLDER_TITLE}
        backTo="/"
        backState={backState}
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
    <AppShell title={PLACEHOLDER_TITLE} backTo="/" backState={backState} headingRef={heading}>
      {load.status === 'loading' ? (
        <StatusView kind="loading" />
      ) : (
        <StatusView
          kind="error"
          title="Scheda non caricata"
          description={loadErrorText(load.error)}
          onRetry={retry}
        />
      )}
    </AppShell>
  );
}
