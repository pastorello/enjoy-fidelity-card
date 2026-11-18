import { useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { ServerFaultError } from '../../lib/serverFault';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { StatusView } from '../../shared/ui/StatusView';
import { CardReadPanel, type CardReadNotice } from '../card-input/CardReadPanel';
import { loadErrorText } from '../customers/loadErrorText';
import type { CustomerSummary } from '../customers/types';
import { isCustomerId, useCustomer } from '../customers/useCustomer';
import styles from './AssociateCardPage.module.css';
import { CardTakenNotice, OpenOwnerLink } from './CardTakenNotice';
import { CustomerRowLink } from './CustomerRowLink';
import { formatCardLabel, shortName } from './formatCard';
import { NetworkError, type CardSummary } from './types';
import { useActiveCard } from './useActiveCard';
import { useAssociateCard } from './useAssociateCard';

const TITLE = 'Associa card';
const PANEL_TITLE = 'Avvicina la card nuova';
// The wireframe says «non ci scrive nulla»: superseded by the decision of 2026-11-17 (SPEC-cards, point 4).
const PANEL_TEXT = 'L’app legge il codice della card e ci scrive il link per vedere i punti.';
const PANEL_SAVING = 'Associazione in corso…';

/** Why the association got no answer, or an unexpected one. */
function associateErrorText(error: unknown): string {
  if (error instanceof ServerFaultError) return `Card non associata. ${loadErrorText(error)}`;
  if (error instanceof NetworkError) return 'Card non associata: controlla la connessione.';
  return 'Card non associata: riprova.';
}

/** The reading panel, the note about the current card, and the footer "Annulla" or the taken notice. */
function AssociateCard({
  customer,
  activeCard,
}: {
  customer: CustomerSummary;
  activeCard: CardSummary | null;
}) {
  const association = useAssociateCard(customer.id, activeCard);
  const name = shortName(customer.name);
  const editPath = `/clienti/${customer.id}/modifica`;

  if (association.status === 'unavailable') {
    return association.reason === 'anonymized' ? (
      <Unavailable customerId={customer.id} />
    ) : (
      <NotFound />
    );
  }

  if (association.status === 'taken') {
    return (
      <AppShell
        title={TITLE}
        backTo={editPath}
        actions={
          <>
            <Button block onClick={association.readAgain}>
              Riprova con un’altra card
            </Button>
            <OpenOwnerLink owner={association.owner} />
          </>
        }
      >
        <CustomerRowLink customer={customer} />
        <CardTakenNotice owner={association.owner} withActions={false} />
      </AppShell>
    );
  }

  const notice: CardReadNotice | null =
    association.status === 'error'
      ? {
          text: associateErrorText(association.error),
          action: (
            <Button variant="secondary" block onClick={association.retry}>
              Riprova
            </Button>
          ),
        }
      : null;

  return (
    <AppShell
      title={TITLE}
      backTo={editPath}
      actions={
        <ButtonLink to={editPath} variant="secondary" block>
          Annulla
        </ButtonLink>
      }
    >
      <CustomerRowLink customer={customer} />
      <CardReadPanel
        title={PANEL_TITLE}
        description={association.status === 'associating' ? PANEL_SAVING : PANEL_TEXT}
        notice={notice}
      />
      {association.status === 'already' ? (
        <output className={styles.note}>
          <Icon name="check" size={20} className={styles.check} />
          <span>Questa è già la card attiva di {name}.</span>
        </output>
      ) : (
        activeCard !== null && (
          <p className={styles.note}>
            <Icon name="credit-card" size={20} />
            <span>
              La card attuale ({formatCardLabel(activeCard.uid)}) verrà disattivata. I punti restano
              a {name}.
            </span>
          </p>
        )
      )}
    </AppShell>
  );
}

/** `customer_anonymized`: an erased customer cannot get a card. */
function Unavailable({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  return (
    <AppShell title={TITLE} backTo={`/clienti/${customerId}`}>
      <StatusView
        kind="error"
        title="Questo cliente non può avere una card."
        retryLabel="Torna alla scheda"
        onRetry={() => void navigate(`/clienti/${customerId}`)}
      />
    </AppShell>
  );
}

/** `customer_not_found`, or an id that is not one: the "not found" page of `customers`. */
function NotFound() {
  return (
    <AppShell
      title={TITLE}
      backTo="/"
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

/**
 * Associa o sostituisci card (`/clienti/:id/card`; SPEC-cards, point 4; wireframes "Associa o
 * sostituisci card" and "Card già di un altro cliente"). The card read is associated to the
 * customer, replacing the active one (named in the note under the panel); every exit after an
 * association goes to the customer page. The link is written from task 17 on: until then the
 * confirmation says «Link non scritto.».
 */
export function AssociateCardPage() {
  const { id = '' } = useParams();
  const customer = useCustomer(id);
  const activeCard = useActiveCard(id, { enabled: isCustomerId(id) });
  const heading = useRef<HTMLHeadingElement>(null);

  if (customer.status === 'not-found') return <NotFound />;
  if (customer.status === 'done' && customer.customer.anonymizedAt !== null) {
    return <Unavailable customerId={id} />;
  }
  if (customer.status === 'done' && activeCard.status === 'done') {
    return <AssociateCard customer={customer.customer} activeCard={activeCard.card} />;
  }

  let error: { title: string; error: unknown; retry: () => void } | null = null;
  if (customer.status === 'error') {
    error = { title: 'Cliente non caricato', error: customer.error, retry: customer.retry };
  } else if (activeCard.status === 'error') {
    error = { title: 'Card non caricata', error: activeCard.error, retry: activeCard.retry };
  }

  function retry() {
    error?.retry();
    heading.current?.focus();
  }

  return (
    <AppShell title={TITLE} backTo={`/clienti/${id}/modifica`} headingRef={heading}>
      {error === null ? (
        <StatusView kind="loading" />
      ) : (
        <StatusView
          kind="error"
          title={error.title}
          description={loadErrorText(error.error)}
          onRetry={retry}
        />
      )}
    </AppShell>
  );
}
