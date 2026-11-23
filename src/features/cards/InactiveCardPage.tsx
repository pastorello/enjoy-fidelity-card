import { useCallback, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { Icon } from '../../shared/ui/Icon';
import { ListRow } from '../../shared/ui/ListRow';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import { StatusView } from '../../shared/ui/StatusView';
import { homeNoticeState } from '../customers/homeNotice';
import { loadErrorText } from '../customers/loadErrorText';
import { useCurrentOperator } from '../identity/AuthProvider';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import { CardLinkScreen, Reactivated } from './CardLinkScreen';
import { NOT_IN_DISPLAY } from './customerName';
import { formatCardDay, formatCardLabel, shortName } from './formatCard';
import styles from './InactiveCardPage.module.css';
import type { CardDetail, CardSummary } from './types';
import { useInactiveCard, type InactiveCardLoad } from './useInactiveCard';
import { reactivatedNotice, useReactivateCard, type ReactivateCard } from './useReactivateCard';

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

/** A part of a dialog title with a glyph Enjoy Display lacks (a card label, a typed name). */
function Plain({ children }: { children: string }) {
  return <span className={styles.plain}>{children}</span>;
}

/** The confirmation of Riattiva (SPEC-customers-v2, point 4, «Riattiva» 1 and 2). */
function reactivateQuestion(card: CardDetail, name: string) {
  const label = formatCardLabel(card.uid);
  const day = card.deactivatedAt === null ? null : formatCardDay(card.deactivatedAt);
  const warning = `Riattiva solo se la card è tornata a ${name}: chi la usa potrà spendere i suoi punti.`;
  if (card.otherActiveCard === null) {
    return {
      title: (
        <>
          Riattivare la card <Plain>{label}</Plain>?
        </>
      ),
      description: day === null ? warning : `Disattivata il ${day}. ${warning}`,
      confirmLabel: 'Riattiva',
    };
  }
  const other = formatCardLabel(card.otherActiveCard.uid);
  return {
    title: <>Scambiare le card di {NOT_IN_DISPLAY.test(name) ? <Plain>{name}</Plain> : name}?</>,
    description: `La card ${label}${day === null ? '' : ` (disattivata il ${day})`} torna attiva. ${warning} La card ${other}, ora attiva, si disattiva e il suo link non mostrerà più i punti. I punti restano a ${name}.`,
    confirmLabel: 'Scambia le card',
  };
}

/**
 * After the reactivation, on the same screen: «Card …E5F6 riattivata per Maria» and the write of
 * the new link (the old one died with the deactivation), with the outcomes and «Salta» of Associa
 * card. Every way out goes to the customer page, in place of this one; a device that does not write
 * goes there at once, with «Link non scritto.».
 */
function WriteLink({ detail, card }: { detail: CardDetail; card: CardSummary }) {
  const navigate = useNavigate();
  const customerPath = `/clienti/${detail.customerId}`;
  const leave = useCallback(
    (linkWritten: boolean) => {
      void navigate(customerPath, {
        replace: true,
        state: homeNoticeState(reactivatedNotice(card.uid, linkWritten)),
      });
    },
    [navigate, customerPath, card.uid],
  );
  const name = detail.customerName ?? '';
  return (
    <CardLinkScreen
      title={TITLE}
      backTo={customerPath}
      customer={{
        id: detail.customerId,
        name,
        anonymizedAt: null,
        balance: detail.customerBalance,
      }}
      card={card}
      intro={<Reactivated uid={card.uid} name={shortName(name)} />}
      onLeave={leave}
    />
  );
}

/**
 * The deactivated card with its customer, and what Riattiva and Riformatta do (SPEC-customers-v2,
 * points 4 and 5), with the confirmation of Riattiva. The card of an erased customer names no one
 * and offers no Riattiva.
 */
function InactiveCard({ card, reactivation }: { card: CardDetail; reactivation: ReactivateCard }) {
  const name = card.customerName === null ? null : shortName(card.customerName);
  const canReactivate = name !== null && reactivation.status !== 'refused';
  const question = name === null ? null : reactivateQuestion(card, name);
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
      {reactivation.status === 'refused' && (
        <p role="alert" className={styles.refused}>
          <Icon name="circle-alert" size={24} className={styles.refusedIcon} />
          <span>{reactivation.text}</span>
        </p>
      )}
      <div className={styles.choices}>
        {canReactivate && (
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
      {question !== null && reactivation.status === 'confirming' && (
        <ConfirmDialog
          // Asked again after `active_card_changed`: a new dialog, with the right card.
          key={reactivation.round}
          open
          title={question.title}
          description={question.description}
          confirmLabel={reactivation.error === null ? question.confirmLabel : 'Riprova'}
          busy={reactivation.busy}
          error={reactivation.error}
          onConfirm={reactivation.confirm}
          onCancel={reactivation.cancel}
        />
      )}
    </>
  );
}

/** «Riattiva la card», for a card with a customer to give it back to (not refused for good). */
function reactivateAction(card: CardDetail, reactivation: ReactivateCard): ReactNode {
  if (card.customerName === null || reactivation.status === 'refused') return undefined;
  return (
    <Button block onClick={reactivation.ask}>
      Riattiva la card
    </Button>
  );
}

/**
 * What the page shows for the card, and the action under it (in the footer on the phone); for a
 * deactivated card, the card itself, which `InactiveCard` shows with Riattiva.
 */
function adminContent(
  load: InactiveCardLoad,
  reactivation: ReactivateCard,
): { content: ReactNode; action?: ReactNode } {
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
  return {
    content: <InactiveCard card={card} reactivation={reactivation} />,
    action: reactivateAction(card, reactivation),
  };
}

/** The deactivated card on screen, if any: the one Riattiva would give back. */
function inactiveCard(load: InactiveCardLoad): CardDetail | null {
  if (load.status !== 'done') return null;
  return !load.card.active && load.card.releasedAt === null ? load.card : null;
}

/**
 * The card, or the state that takes its place, in one shell (the heading stays put); once
 * reactivated, the write of its link.
 */
function AdminView({ cardId }: { cardId: string }) {
  const load = useInactiveCard(cardId);
  const card = inactiveCard(load);
  const reactivation = useReactivateCard(card, load.reload);
  if (reactivation.status === 'reactivated' && card !== null) {
    return <WriteLink detail={card} card={reactivation.card} />;
  }
  const { content, action } = adminContent(load, reactivation);
  return <Page action={action}>{content}</Page>;
}

/**
 * «Card non attiva» (`/card/:cardId`, SPEC-customers-v2 points 4 and 5): where an administrator
 * lands after reading a deactivated card on the home, by the id of its row (never the uid). An
 * operator who opens the URL by hand is turned away without a request: the server would refuse
 * the actions anyway. Riformatta comes with task 32.
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
