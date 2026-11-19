import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { formatTime } from '../../shared/format';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { StatusView } from '../../shared/ui/StatusView';
import { CustomerRowLink } from '../cards/CustomerRowLink';
import { loadErrorText } from '../customers/loadErrorText';
import { useCustomer } from '../customers/useCustomer';
import { useCurrentOperator } from '../identity/AuthProvider';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import { CancelMovementDialog, type CancelOutcome } from './CancelMovementDialog';
import { correctionText, formatSignedPoints, groupByDay, movementLabel } from './formatMovement';
import styles from './MovementsPage.module.css';
import type { Movement } from './types';
import { useMovementHistory, type MovementHistory } from './useMovementHistory';

const TITLE = 'Movimenti';
const SPENT_TEXT = 'Punti già spesi: questa spesa non si può più annullare.';
// Proposed: the server refused for another reason (a correction, a lost role): nothing changed.
const REFUSED_TEXT = 'Annullamento non riuscito: il movimento non si può annullare.';

/** What an administrator can do on a row: nothing, "Annulla", or "Punti già spesi" instead. */
type RowControl = 'none' | 'cancel' | 'spent';

/**
 * SPEC-ledger point 9: purchases and redemptions not cancelled; a purchase whose points the
 * balance no longer holds shows "Punti già spesi" (the server refuses it with EC001 anyway).
 */
function rowControl(movement: Movement, balance: number): RowControl {
  if (movement.kind === 'correction' || movement.cancelledById !== null) return 'none';
  if (movement.kind === 'purchase' && balance - movement.points < 0) return 'spent';
  return 'cancel';
}

/** "10:42 · Giulia", then the correction's text or "annullata" (SPEC-ledger point 9). */
function movementLine(movement: Movement): string {
  const parts = [formatTime(movement.createdAt), movement.operatorName];
  const correction = correctionText(movement);
  if (correction !== null) parts.push(correction);
  if (movement.cancelledById !== null) parts.push('annullata');
  return parts.join(' · ');
}

/**
 * One movement: label, time and operator, signed points. Struck through once cancelled. For an
 * administrator (`admin` set) "Annulla" or "Punti già spesi"; highlighted while its dialog is open.
 */
function MovementRow({
  movement,
  admin,
}: {
  movement: Movement;
  admin: { balance: number; selected: boolean; onCancel: (movement: Movement) => void } | null;
}) {
  const labelId = useId();
  const cancelled = movement.cancelledById !== null;
  const label = movementLabel(movement);
  const points = formatSignedPoints(movement.points);
  const control = admin ? rowControl(movement, admin.balance) : 'none';
  return (
    <li
      className={styles.row}
      data-cancelled={cancelled || undefined}
      data-selected={admin?.selected || undefined}
    >
      <span className={styles.text}>
        <span id={labelId} className={styles.label}>
          {cancelled ? <s>{label}</s> : label}
        </span>
        <span className={styles.line}>{movementLine(movement)}</span>
      </span>
      <span className={styles.points}>{cancelled ? <s>{points}</s> : points}</span>
      {control === 'cancel' && (
        <Button
          variant="danger-secondary"
          className={styles.cancel}
          aria-describedby={labelId}
          onClick={() => admin?.onCancel(movement)}
        >
          Annulla
        </Button>
      )}
      {control === 'spent' && <span className={styles.spent}>Punti già spesi</span>}
    </li>
  );
}

type AdminControls = {
  balance: number;
  selectedId: string | null;
  onCancel: (movement: Movement) => void;
};

/** The days (OGGI, IERI, "8 NOVEMBRE"), "Mostra altri" and its failure. */
function History({
  history,
  admin,
}: {
  history: Extract<MovementHistory, { status: 'done' }>;
  /** Null for an operator: no "Annulla" in the history (Open Question 7). */
  admin: AdminControls | null;
}) {
  if (history.movements.length === 0) {
    return <p className={styles.empty}>Ancora nessun movimento</p>;
  }
  return (
    <>
      {groupByDay(history.movements).map((day) => (
        <section key={day.key} aria-labelledby={`day-${day.key}`} className={styles.day}>
          <h2 id={`day-${day.key}`} className={styles.dayTitle}>
            {day.title}
          </h2>
          <ul className={styles.list}>
            {day.movements.map((movement) => (
              <MovementRow
                key={movement.id}
                movement={movement}
                admin={
                  admin && {
                    balance: admin.balance,
                    selected: admin.selectedId === movement.id,
                    onCancel: admin.onCancel,
                  }
                }
              />
            ))}
          </ul>
        </section>
      ))}
      {history.moreFailed && (
        <p role="alert" className={styles.moreError}>
          <Icon name="circle-alert" size={20} />
          <span>Non riesco a caricare altri movimenti</span>
        </p>
      )}
      {history.hasMore && (
        <Button variant="secondary" block busy={history.loadingMore} onClick={history.loadMore}>
          Mostra altri
        </Button>
      )}
    </>
  );
}

/**
 * Movimenti (`/clienti/:id/movimenti`; SPEC-ledger point 9; wireframe "Movimenti"): "Indietro" to
 * the customer page, the customer row, then the movements grouped by day in Rome, newest first, 50
 * at a time with "Mostra altri". The history of an erased customer stays visible (Open Question 14).
 * An administrator cancels a purchase or a redemption from here, after `CancelMovementDialog`:
 * once settled the history and the balance load again and the focus goes to the title.
 */
export function MovementsPage() {
  const { id = '' } = useParams();
  const load = useCustomer(id);
  const history = useMovementHistory(id);
  const heading = useRef<HTMLHeadingElement>(null);
  const { role } = useCurrentOperator();
  // 1280×800: the same content in one wide column.
  const tablet = useTabletLayout();
  const [target, setTarget] = useState<Movement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped when a cancellation settles: the button that opened the dialog may be gone.
  const [settledCount, setSettledCount] = useState(0);
  const { reload } = history;
  const { refresh } = load;

  useEffect(() => {
    if (settledCount > 0) heading.current?.focus();
  }, [settledCount]);

  const openCancel = useCallback((movement: Movement) => {
    setNotice(null);
    setTarget(movement);
  }, []);

  const settle = useCallback(
    (outcome: CancelOutcome) => {
      setTarget(null);
      if (outcome === 'forbidden') return;
      if (outcome === 'spent') setNotice(SPENT_TEXT);
      else if (outcome === 'refused') setNotice(REFUSED_TEXT);
      reload();
      refresh();
      setSettledCount((count) => count + 1);
    },
    [reload, refresh],
  );

  // "Riprova" gives way to the loading state: the focus goes to the title, not to <body>.
  function retryCustomer() {
    load.retry();
    heading.current?.focus();
  }
  function retryHistory() {
    history.retry();
    heading.current?.focus();
  }

  let actions: ReactNode = null;
  let body: ReactNode;
  if (load.status === 'not-found') {
    actions = (
      <ButtonLink to="/" block>
        Torna all’inizio
      </ButtonLink>
    );
    body = (
      <StatusView
        kind="empty"
        icon="search"
        title="Cliente non trovato"
        description="Il collegamento potrebbe essere vecchio o scritto male."
      />
    );
  } else if (load.status === 'error') {
    body = (
      <StatusView
        kind="error"
        title="Cliente non caricato"
        description={loadErrorText(load.error)}
        onRetry={retryCustomer}
      />
    );
  } else if (load.status === 'loading') {
    body = <StatusView kind="loading" />;
  } else {
    let movements: ReactNode;
    if (history.status === 'loading') {
      movements = <StatusView kind="loading" />;
    } else if (history.status === 'error') {
      movements = (
        <StatusView
          kind="error"
          title="Movimenti non caricati"
          description={loadErrorText(history.error)}
          onRetry={retryHistory}
        />
      );
    } else {
      const admin =
        role === 'admin'
          ? { balance: load.customer.balance, selectedId: target?.id ?? null, onCancel: openCancel }
          : null;
      movements = <History history={history} admin={admin} />;
    }
    body = (
      <>
        <CustomerRowLink customer={load.customer} />
        {notice !== null && (
          <p role="alert" className={styles.notice}>
            <Icon name="circle-alert" size={20} />
            <span>{notice}</span>
          </p>
        )}
        {movements}
        {target !== null && (
          <CancelMovementDialog
            key={target.id}
            movement={target}
            balance={load.customer.balance}
            onClose={() => setTarget(null)}
            onSettled={settle}
          />
        )}
      </>
    );
  }

  return (
    <AppShell
      title={TITLE}
      backTo={`/clienti/${id}`}
      backInHistory
      headingRef={heading}
      actions={actions}
    >
      {tablet ? (
        // 1280×800 (wireframe "Tablet: movimenti del cliente"): one wide column, 32 px from the edges.
        <div className={styles.tabletColumn} data-tablet="true" data-testid="movements-column">
          {body}
        </div>
      ) : (
        body
      )}
    </AppShell>
  );
}
