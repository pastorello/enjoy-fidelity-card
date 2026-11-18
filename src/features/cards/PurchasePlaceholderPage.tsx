import { useRef } from 'react';
import { useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { ButtonLink } from '../../shared/ui/Button';
import { StatusView } from '../../shared/ui/StatusView';
import { loadErrorText } from '../customers/loadErrorText';
import { useCustomer } from '../customers/useCustomer';
import { CustomerRowLink } from './CustomerRowLink';

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
    return (
      <AppShell title={TITLE} backTo="/" headingRef={heading}>
        <CustomerRowLink customer={load.customer} />
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
