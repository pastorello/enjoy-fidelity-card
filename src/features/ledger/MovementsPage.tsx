import { useRef, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { formatTime } from '../../shared/format';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { StatusView } from '../../shared/ui/StatusView';
import { CustomerRowLink } from '../cards/CustomerRowLink';
import { loadErrorText } from '../customers/loadErrorText';
import { useCustomer } from '../customers/useCustomer';
import { correctionText, formatSignedPoints, groupByDay, movementLabel } from './formatMovement';
import styles from './MovementsPage.module.css';
import type { Movement } from './types';
import { useMovementHistory, type MovementHistory } from './useMovementHistory';

const TITLE = 'Movimenti';

/** "10:42 · Giulia", then the correction's text or "annullata" (SPEC-ledger point 9). */
function movementLine(movement: Movement): string {
  const parts = [formatTime(movement.createdAt), movement.operatorName];
  const correction = correctionText(movement);
  if (correction !== null) parts.push(correction);
  if (movement.cancelledById !== null) parts.push('annullata');
  return parts.join(' · ');
}

/** One movement: label, time and operator, signed points. Struck through once cancelled. */
function MovementRow({ movement }: { movement: Movement }) {
  const cancelled = movement.cancelledById !== null;
  const label = movementLabel(movement);
  const points = formatSignedPoints(movement.points);
  return (
    <li className={styles.row} data-cancelled={cancelled || undefined}>
      <span className={styles.text}>
        <span className={styles.label}>{cancelled ? <s>{label}</s> : label}</span>
        <span className={styles.line}>{movementLine(movement)}</span>
      </span>
      <span className={styles.points}>{cancelled ? <s>{points}</s> : points}</span>
    </li>
  );
}

/** The days (OGGI, IERI, "8 NOVEMBRE"), "Mostra altri" and its failure. */
function History({ history }: { history: Extract<MovementHistory, { status: 'done' }> }) {
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
              <MovementRow key={movement.id} movement={movement} />
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
 */
export function MovementsPage() {
  const { id = '' } = useParams();
  const load = useCustomer(id);
  const history = useMovementHistory(id);
  const heading = useRef<HTMLHeadingElement>(null);

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
      movements = <History history={history} />;
    }
    body = (
      <>
        <CustomerRowLink customer={load.customer} />
        {movements}
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
      {body}
    </AppShell>
  );
}
