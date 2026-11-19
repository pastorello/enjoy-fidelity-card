import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { ServerFaultError } from '../../lib/serverFault';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { StatusView } from '../../shared/ui/StatusView';
import { CardReadPanel, type CardReadNotice } from '../card-input/CardReadPanel';
import { homeNoticeState } from '../customers/homeNotice';
import { loadErrorText } from '../customers/loadErrorText';
import type { CustomerSummary } from '../customers/types';
import { isCustomerId, useCustomer } from '../customers/useCustomer';
import styles from './AssociateCardPage.module.css';
import { Associated, CardLinkScreen } from './CardLinkScreen';
import { CardTakenNotice, OpenOwnerLink } from './CardTakenNotice';
import { CustomerRowLink } from './CustomerRowLink';
import { formatCardLabel, shortName } from './formatCard';
import { NetworkError, type CardSummary } from './types';
import { useActiveCard } from './useActiveCard';
import { associatedNotice, useAssociateCard } from './useAssociateCard';
import { useUsbCardInput } from '../tablet-kiosk/useUsbCardInput';

const TITLE = 'Associa card';
const PANEL_TITLE = 'Avvicina la card nuova';
// The wireframe says «non ci scrive nulla»: superseded by the decision of 2026-11-17 (SPEC-cards, point 4).
const PANEL_TEXT = 'L’app legge il codice della card e ci scrive il link per vedere i punti.';
const PANEL_SAVING = 'Associazione in corso…';
/** On the till tablet (wireframe "Tablet: associa card"): the USB reader reads, and never writes. */
const USB_PANEL_TITLE = 'Passa la card nuova sul lettore';
const USB_PANEL_TEXT = 'L’app legge solo il codice della card: non ci scrive nulla.';

/** Why the association got no answer, or an unexpected one. */
function associateErrorText(error: unknown): string {
  if (error instanceof ServerFaultError) return `Card non associata. ${loadErrorText(error)}`;
  if (error instanceof NetworkError) return 'Card non associata: controlla la connessione.';
  return 'Card non associata: riprova.';
}

/** «Questa è già la card attiva di Maria.» */
function AlreadyActive({ name }: { name: string }) {
  return (
    <output className={styles.note}>
      <Icon name="check" size={20} className={styles.check} />
      <span>Questa è già la card attiva di {name}.</span>
    </output>
  );
}

/**
 * The write of the link on the card just associated (SPEC-cards, points 4 and 8; boards
 * "Associa-link" and "Associa-link-errore"). Every way out goes to the customer page, in place of
 * this one: «Card …A1B2 associata» once the link is written, with «Link non scritto.» after «Salta»,
 * «Più tardi» or on a phone that does not write (the association is saved either way).
 */
function WriteLink({
  customer,
  card,
  intro,
}: {
  customer: CustomerSummary;
  card: CardSummary;
  intro: ReactNode;
}) {
  const navigate = useNavigate();
  const customerPath = `/clienti/${customer.id}`;
  const leave = useCallback(
    (linkWritten: boolean) => {
      void navigate(customerPath, {
        replace: true,
        state: homeNoticeState(associatedNotice(card.uid, linkWritten)),
      });
    },
    [navigate, customerPath, card.uid],
  );
  return (
    <CardLinkScreen
      title={TITLE}
      backTo={customerPath}
      customer={customer}
      card={card}
      intro={intro}
      onLeave={leave}
    />
  );
}

/** The reading panel, the note about the current card, and the footer "Annulla" or the taken notice. */
function AssociateCard({
  customer,
  activeCard,
}: {
  customer: CustomerSummary;
  activeCard: CardSummary | null;
}) {
  // «Scrivi di nuovo il link» on the card already active, whose link is written.
  const [rewrite, setRewrite] = useState(false);
  // «Riprova con un’altra card» unmounts with the notice: the reading panel takes the focus.
  const [focusReading, setFocusReading] = useState(false);
  const association = useAssociateCard(customer.id, activeCard, { writing: rewrite });
  const usb = useUsbCardInput();
  const name = shortName(customer.name);
  const editPath = `/clienti/${customer.id}/modifica`;

  if (association.status === 'associated') {
    return (
      <WriteLink customer={customer} card={association.card} intro={<Associated name={name} />} />
    );
  }

  if (
    association.status === 'already' &&
    (rewrite || association.card.linkState === 'not-written')
  ) {
    return (
      <WriteLink
        customer={customer}
        card={association.card}
        intro={<AlreadyActive name={name} />}
      />
    );
  }

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
            <Button
              block
              onClick={() => {
                setFocusReading(true);
                association.readAgain();
              }}
            >
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
        mode={usb ? 'usb' : 'web-nfc'}
        title={usb ? USB_PANEL_TITLE : PANEL_TITLE}
        description={
          association.status === 'associating' ? PANEL_SAVING : usb ? USB_PANEL_TEXT : PANEL_TEXT
        }
        notice={notice}
        focusOnMount={focusReading}
      />
      {association.status === 'already' ? (
        <>
          <AlreadyActive name={name} />
          <Button variant="secondary" block onClick={() => setRewrite(true)}>
            Scrivi di nuovo il link
          </Button>
        </>
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
 * sostituisci card" and "Card già di un altro cliente", boards "Associa-link" and
 * "Associa-link-errore"). The card read is associated to the customer, replacing the active one
 * (named in the note under the panel), and its link is written; every exit after an association
 * goes to the customer page.
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
