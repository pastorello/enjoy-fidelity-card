import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { ListRow } from '../../shared/ui/ListRow';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import { StatusView } from '../../shared/ui/StatusView';
import { loadErrorText } from '../customers/loadErrorText';
import { useCurrentOperator } from '../identity/AuthProvider';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import { formatCardDay, formatCardLabel, shortName } from './formatCard';
import styles from './InactiveCardPage.module.css';
import type { CardDetail } from './types';
import { useInactiveCard, type InactiveCardLoad } from './useInactiveCard';

const TITLE = 'Card non attiva';
const OPERATOR_ONLY = 'Solo un amministratore può riattivare o riformattare una card.';

/**
 * The page around a state: on the phone the action sits in the footer; on the till tablet in the
 * wide column, away from the bottom edge (SPEC-tablet-kiosk, point 10).
 */
function Page({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const tablet = useTabletLayout();
  if (tablet) {
    return (
      <AppShell title={TITLE} backTo="/">
        <div className={styles.tabletColumn} data-tablet-column="inactive-card">
          {children}
          {action}
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell title={TITLE} backTo="/" actions={action}>
      {children}
    </AppShell>
  );
}

const homeLink = (
  <ButtonLink to="/" block>
    Torna all’inizio
  </ButtonLink>
);

/** «Card …5566» and, under it, «Disattivata il 12 nov»: the card the admin just read. */
function CardRow({ card }: { card: CardDetail }) {
  return (
    <div className={styles.cardRow}>
      <Icon name="credit-card" className={styles.cardIcon} />
      <span className={styles.cardText}>
        <span className={styles.cardLabel}>Card {formatCardLabel(card.uid)}</span>
        {card.deactivatedAt !== null && (
          <span className={styles.cardDate}>
            Disattivata il {formatCardDay(card.deactivatedAt)}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The deactivated card with its customer, and what Riattiva and Riformatta do (SPEC-customers-v2,
 * points 4 and 5). The card of an erased customer names no one and offers no Riattiva.
 */
function InactiveCard({ card }: { card: CardDetail }) {
  const name = card.customerName === null ? null : shortName(card.customerName);
  return (
    <>
      <CardRow card={card} />
      {name === null || card.customerName === null ? (
        <p className={styles.erased}>Era di un cliente i cui dati sono stati cancellati.</p>
      ) : (
        <ul className={styles.customer}>
          <ListRow
            to={`/clienti/${card.customerId}`}
            title={`Era di ${card.customerName}`}
            trailing={<PointsBadge points={card.customerBalance} />}
          />
        </ul>
      )}
      <div className={styles.choices}>
        {name !== null && (
          <p className={styles.choice}>
            {card.otherActiveCard === null
              ? `La card torna a ${name} e apre di nuovo la sua spesa.`
              : `La card torna a ${name} al posto della card ${formatCardLabel(card.otherActiveCard.uid)}, che si disattiva. I punti restano a ${name}.`}
          </p>
        )}
        <p className={styles.choice}>
          {name === null
            ? 'La card si svuota e torna come nuova: potrà essere data a un cliente nuovo.'
            : `La card si svuota e non sarà più di ${name}, per sempre: potrà essere data a un cliente nuovo. Punti e movimenti restano a ${name}.`}
        </p>
      </div>
    </>
  );
}

/** What the page shows for the card, and the action under it (in the footer on the phone). */
function adminContent(load: InactiveCardLoad): { content: ReactNode; action?: ReactNode } {
  switch (load.status) {
    case 'loading':
      return { content: <StatusView kind="loading" /> };
    case 'error':
      return {
        content: (
          <StatusView
            kind="error"
            title="Card non caricata"
            description={loadErrorText(load.error)}
            onRetry={load.retry}
          />
        ),
      };
    case 'not-found':
      return {
        content: (
          <StatusView
            kind="empty"
            icon="credit-card"
            title="Card non trovata"
            description="Il collegamento potrebbe essere vecchio o scritto male."
          />
        ),
        action: homeLink,
      };
    case 'done':
      break;
  }
  const { card } = load;
  if (card.releasedAt !== null) {
    return {
      content: (
        <StatusView
          kind="empty"
          icon="credit-card"
          title="Questa card è già stata riformattata: ora è libera."
        />
      ),
      action: homeLink,
    };
  }
  if (card.active) {
    // Reactivated meanwhile by another administrator (an erased customer has no active card).
    return {
      content: <StatusView kind="empty" icon="check" title="Questa card è attiva." />,
      action:
        card.customerName === null ? (
          homeLink
        ) : (
          <ButtonLink to={`/clienti/${card.customerId}`} block>
            Apri la scheda di {shortName(card.customerName)}
          </ButtonLink>
        ),
    };
  }
  return { content: <InactiveCard card={card} /> };
}

/** The card, or the state that takes its place, in one shell (the heading stays put). */
function AdminView({ cardId }: { cardId: string }) {
  const { content, action } = adminContent(useInactiveCard(cardId));
  return <Page action={action}>{content}</Page>;
}

/**
 * «Card non attiva» (`/card/:cardId`, SPEC-customers-v2 points 4 and 5): where an administrator
 * lands after reading a deactivated card on the home, by the id of its row (never the uid). An
 * operator who opens the URL by hand is turned away without a request: the server would refuse
 * the actions anyway. Riattiva and Riformatta come with tasks 31 and 32.
 */
export function InactiveCardPage() {
  const { cardId = '' } = useParams();
  const { role } = useCurrentOperator();
  const navigate = useNavigate();

  if (role !== 'admin') {
    return (
      <Page>
        <StatusView
          kind="error"
          title={OPERATOR_ONLY}
          retryLabel="Torna all’inizio"
          onRetry={() => void navigate('/')}
        />
      </Page>
    );
  }
  return <AdminView cardId={cardId} />;
}
