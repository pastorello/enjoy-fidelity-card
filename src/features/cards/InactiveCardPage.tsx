import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ServerFaultError } from '../../lib/serverFault';
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
import writerStyles from './CardLinkWriter.module.css';
import styles from './InactiveCardPage.module.css';
import {
  CARD_FORBIDDEN_TEXT,
  CardActiveError,
  CardForbiddenError,
  NetworkError,
  type CardDetail,
  type CardSummary,
} from './types';
import { useInactiveCard, type InactiveCardLoad } from './useInactiveCard';
import { reactivatedNotice, useReactivateCard, type ReactivateCard } from './useReactivateCard';
import {
  isReleaseRetryable,
  reformattedNotice,
  useReformatCard,
  type ReformatCard,
  type ReformatFailure,
} from './useReformatCard';

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

/** The confirmation of Riformatta (SPEC-customers-v2, point 4, «Riformatta» 1). */
function reformatQuestion(card: CardDetail) {
  const label = formatCardLabel(card.uid);
  return {
    title: (
      <>
        Riformattare la card <Plain>{label}</Plain>?
      </>
    ),
    description:
      card.customerName === null
        ? 'La card si svuota e torna come nuova. Non si può tornare indietro.'
        : `La card si svuota e non sarà più di ${card.customerName}, per sempre. Punti e movimenti restano a ${shortName(card.customerName)}. Non si può tornare indietro.`,
  };
}

const DEVICE_NOTE =
  'Per riformattare la card serve un telefono Android con l’NFC attivo: apri Enjoy Card sul telefono e avvicina la card.';

/** Whether the reformatting has taken the place of the choices (the erase, its release, an outcome). */
function reformatting(reformat: ReformatCard): boolean {
  return (
    reformat.status === 'erasing' ||
    reformat.status === 'releasing' ||
    reformat.status === 'released' ||
    reformat.status === 'failed'
  );
}

const DETACHED = 'Card non riformattata: si è staccata troppo presto.';

/** What each outcome of `eraseCard` without an empty card says, given the card label. */
const ERASE_FAILURES: Record<
  Extract<ReformatFailure, { kind: 'erase' }>['reason'],
  (label: string) => string
> = {
  timeout: () => DETACHED,
  io: () => DETACHED,
  'wrong-card': (label) => `Questa non è la card ${label}: avvicina quella giusta.`,
  'verify-failed': () => 'La card non risulta vuota. Riprova.',
  'not-allowed': () =>
    'Il telefono non permette di scrivere la card: controlla il permesso NFC di Chrome.',
  unreadable: (label) => `La card non si legge. È la card ${label}? Puoi riformattarla comunque.`,
  // Another write still running.
  busy: () => 'Card non riformattata: riprova.',
};

/** What an outcome without a free card says (SPEC-customers-v2, point 4, «Riformatta» 5 to 7). */
function reformatFailureText(failure: ReformatFailure, card: CardDetail): string {
  const label = formatCardLabel(card.uid);
  if (failure.kind === 'release') {
    const { error } = failure;
    if (error instanceof CardActiveError) {
      const reactivated = 'La card è stata riattivata nel frattempo e non è stata liberata.';
      return card.customerName === null
        ? reactivated
        : `${reactivated} Il suo link è stato cancellato: riscrivilo dalla scheda di ${shortName(card.customerName)}.`;
    }
    if (error instanceof CardForbiddenError) return CARD_FORBIDDEN_TEXT;
    if (error instanceof NetworkError) {
      return 'Card svuotata ma non liberata: controlla la connessione.';
    }
    if (error instanceof ServerFaultError) {
      return `Card svuotata ma non liberata. ${loadErrorText(error)}`;
    }
    return isReleaseRetryable(error)
      ? 'Card svuotata ma non liberata: riprova.'
      : 'Card svuotata ma non liberata.';
  }
  // Only once write() had started can the other card have been emptied.
  if (
    failure.reason === 'wrong-card' &&
    failure.mayHaveWritten === true &&
    failure.otherUid !== undefined
  ) {
    return `Questa non è la card ${label}. La card ${formatCardLabel(failure.otherUid)} potrebbe essere stata svuotata: se aveva il link ai punti, riscrivilo dalla scheda del suo cliente.`;
  }
  return ERASE_FAILURES[failure.reason](label);
}

/**
 * The erase of the card, live (`aria-live="polite"`), then its outcome in an alert: the boards of the
 * link write, with the texts of Riformatta. Its buttons are in `reformatActions`.
 */
function ReformatPanel({ reformat, card }: { reformat: ReformatCard; card: CardDetail }) {
  const texts = useRef<HTMLDivElement>(null);
  const { status } = reformat;
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (shown.current === status) return;
    shown.current = status;
    // The button tapped («Riformatta», «Riprova»…) unmounted: the focus fell to the page, so it goes
    // to the text of the new state.
    const focused = document.activeElement;
    if (focused === null || focused === document.body) texts.current?.focus();
  }, [status]);

  if (reformat.status === 'failed') {
    return (
      <section role="alert" className={writerStyles.failure}>
        <Icon name="circle-alert" size={48} className={writerStyles.failureIcon} />
        <div ref={texts} tabIndex={-1}>
          <p className={writerStyles.failureText}>{reformatFailureText(reformat.failure, card)}</p>
        </div>
      </section>
    );
  }
  let body;
  if (reformat.status === 'erasing' && reformat.step === 'waiting-card') {
    body = (
      <p className={writerStyles.title}>
        {/* Enjoy Display has no "…": the label is set in the body font. */}
        Avvicina la card <span className={writerStyles.label}>{formatCardLabel(card.uid)}</span>
      </p>
    );
  } else if (reformat.status === 'erasing' && reformat.step === 'writing') {
    body = (
      <>
        <p className={writerStyles.title}>Tieni la card appoggiata</p>
        <p className={writerStyles.progress}>
          <Icon name="loader-circle" size={16} className={writerStyles.spinner} />
          Svuoto la card…
        </p>
      </>
    );
  } else {
    // The verification, and the release that follows it at once.
    body = <p className={writerStyles.title}>Controllo: allontana la card e riavvicinala</p>;
  }
  return (
    <section aria-label="Riformattazione della card" className={writerStyles.panel}>
      <Icon name="nfc" size={64} className={writerStyles.icon} />
      <div ref={texts} tabIndex={-1} aria-live="polite" className={writerStyles.texts}>
        {body}
      </div>
    </section>
  );
}

/** «Per riformattare la card serve un telefono Android…», in place of «Riformatta la card». */
function DeviceNote() {
  return (
    <p className={styles.deviceNote}>
      <Icon name="nfc-off" size={24} className={styles.deviceNoteIcon} />
      <span>{DEVICE_NOTE}</span>
    </p>
  );
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
function InactiveCard({
  card,
  reactivation,
  reformat,
}: {
  card: CardDetail;
  reactivation: ReactivateCard;
  reformat: ReformatCard;
}) {
  const name = card.customerName === null ? null : shortName(card.customerName);
  const canReactivate = name !== null && reactivation.status !== 'refused';
  const question = name === null ? null : reactivateQuestion(card, name);
  const erase = reformatQuestion(card);
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
      {reformatting(reformat) ? (
        <ReformatPanel reformat={reformat} card={card} />
      ) : (
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
          {!canReformat(reformat) && <DeviceNote />}
        </div>
      )}
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
      {reformat.status === 'confirming' && (
        <ConfirmDialog
          open
          tone="danger"
          title={erase.title}
          description={erase.description}
          confirmLabel="Riformatta"
          onConfirm={reformat.confirm}
          onCancel={reformat.cancel}
        />
      )}
    </>
  );
}

/** Whether «Riformatta la card» is offered: a phone that writes, not stopped writing mid-way. */
function canReformat(reformat: ReformatCard): boolean {
  return reformat.canWrite && reformat.status !== 'cannot-write';
}

/** The way out after a release refused for good: the customer's page, or the home. */
function leaveAfterRefusal(card: CardDetail, failure: ReformatFailure): ReactNode {
  if (
    failure.kind === 'release' &&
    failure.error instanceof CardActiveError &&
    card.customerName !== null
  ) {
    return (
      <ButtonLink to={`/clienti/${card.customerId}`} block>
        Apri la scheda di {shortName(card.customerName)}
      </ButtonLink>
    );
  }
  return homeLink;
}

/** The buttons of the reformatting: «Annulla» while erasing; after an outcome, what can be done. */
function reformatActions(card: CardDetail, reformat: ReformatCard): ReactNode {
  const stop = (
    <Button key="cancel" variant="secondary" block onClick={reformat.cancel}>
      Annulla
    </Button>
  );
  if (reformat.status === 'erasing') return stop;
  if (reformat.status !== 'failed') return undefined;
  const { failure } = reformat;
  if (failure.kind === 'release' && !isReleaseRetryable(failure.error)) {
    return leaveAfterRefusal(card, failure);
  }
  return (
    <>
      {failure.kind === 'erase' && failure.reason === 'unreadable' ? (
        <Button block onClick={reformat.eraseAnyway}>
          Riformatta comunque
        </Button>
      ) : (
        <Button block onClick={reformat.retry}>
          Riprova
        </Button>
      )}
      {stop}
    </>
  );
}

/**
 * «Riattiva la card», for a card with a customer to give it back to (not refused for good), and
 * «Riformatta la card» on a phone that writes; while reformatting, the buttons of the erase.
 */
function cardActions(
  card: CardDetail,
  reactivation: ReactivateCard,
  reformat: ReformatCard,
): ReactNode {
  if (reformatting(reformat)) return reformatActions(card, reformat);
  const reactivate = card.customerName !== null && reactivation.status !== 'refused';
  const reformatButton = canReformat(reformat);
  if (!reactivate && !reformatButton) return undefined;
  return (
    <>
      {reactivate && (
        <Button block onClick={reactivation.ask}>
          Riattiva la card
        </Button>
      )}
      {reformatButton && (
        <Button variant="danger-secondary" block onClick={reformat.ask}>
          Riformatta la card
        </Button>
      )}
    </>
  );
}

/**
 * What the page shows for the card, and the action under it (in the footer on the phone); for a
 * deactivated card, the card itself, which `InactiveCard` shows with Riattiva.
 */
function adminContent(
  load: InactiveCardLoad,
  reactivation: ReactivateCard,
  reformat: ReformatCard,
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
    content: <InactiveCard card={card} reactivation={reactivation} reformat={reformat} />,
    action: cardActions(card, reactivation, reformat),
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
  const navigate = useNavigate();
  const uid = card?.uid ?? null;
  // Free: the home, in place of this page, says so once.
  const onReleased = useCallback(() => {
    if (uid === null) return;
    void navigate('/', { replace: true, state: homeNoticeState(reformattedNotice(uid)) });
  }, [navigate, uid]);
  const reformat = useReformatCard(card, onReleased);
  if (reactivation.status === 'reactivated' && card !== null) {
    return <WriteLink detail={card} card={reactivation.card} />;
  }
  const { content, action } = adminContent(load, reactivation, reformat);
  return <Page action={action}>{content}</Page>;
}

/**
 * «Card non attiva» (`/card/:cardId`, SPEC-customers-v2 points 4 and 5): where an administrator
 * lands after reading a deactivated card on the home, by the id of its row (never the uid). An
 * operator who opens the URL by hand is turned away without a request: the server would refuse
 * the actions anyway.
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
