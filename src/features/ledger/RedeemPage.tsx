import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { formatInteger } from '../../shared/format';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { PointsBadge } from '../../shared/ui/PointsBadge';
import { StatusView } from '../../shared/ui/StatusView';
import { CustomerRowLink } from '../cards/CustomerRowLink';
import { loadErrorText } from '../customers/loadErrorText';
import type { CustomerSummary } from '../customers/types';
import { useCustomer, type CustomerLoad } from '../customers/useCustomer';
import { useAuth } from '../identity/AuthProvider';
import type { Reward } from '../rewards/types';
import { formatMovementDate, formatSignedPoints } from './formatMovement';
import { LedgerDoneView } from './LedgerDoneView';
import { LedgerFailure } from './LedgerFailure';
import { useLedgerService } from './LedgerServiceProvider';
import styles from './RedeemPage.module.css';
import { LedgerError, type LedgerResult } from './types';
import { useActiveRewards, type ActiveRewardsLoad } from './useActiveRewards';
import { isDefinitive, useOperation } from './useOperation';

const TITLE = 'Riscatta premio';

/** No answer (network, or none within 8 s) or a fault of the server: "Riprova" resends the id. */
type Uncertain = 'network' | 'server';

const FAILURE_TITLE = 'Riscatto non salvato';
const FAILURE_TEXT: Record<Uncertain, string> = {
  network:
    'Il telefono non è connesso a internet. Riprova appena torna la rete: il riscatto non verrà registrato due volte.',
  server:
    'Il server non ha risposto correttamente. Riprova: il riscatto non verrà registrato due volte.',
};

/** Why a redemption was refused for good (the operation id is gone with it; SPEC-ledger 5). */
type Refusal = 'reward-unavailable' | 'insufficient-balance' | 'invalid';

const REFUSAL_TEXT: Record<Refusal, string> = {
  'reward-unavailable': 'Premio non più disponibile',
  'insufficient-balance': 'Saldo insufficiente: il saldo è cambiato, controlla e riprova.',
  invalid: 'Riscatto non registrato: dati non validi. Ricomincia.',
};

function ledgerKind(error: unknown) {
  return error instanceof LedgerError ? error.kind : null;
}

function pointsWord(points: number): string {
  return Math.abs(points) === 1 ? 'punto' : 'punti';
}

/**
 * Premio riscattato (SPEC-ledger, point 7): "<premio> per Maria Rossi · −100 punti" and "Oggi
 * 10:45 · Giulia", from the movement the server returned; "Annulla il riscatto" sends
 * `cancelMovement` with its own operation id; `forbidden` goes back to /accedi.
 */
function RedeemDone({ customer, result }: { customer: CustomerSummary; result: LedgerResult }) {
  const { movement, balance } = result;
  const service = useLedgerService();
  const { reportNotEnabled } = useAuth();
  const cancel = useOperation((operationId) =>
    service.cancelMovement({ operationId, movementId: movement.id }),
  );
  const forbidden = cancel.status === 'error' && ledgerKind(cancel.error) === 'forbidden';

  useEffect(() => {
    if (forbidden) void reportNotEnabled();
  }, [forbidden, reportNotEnabled]);

  return (
    <LedgerDoneView
      title="Premio riscattato"
      summary={`${movement.description ?? ''} per ${customer.name} · ${formatSignedPoints(
        movement.points,
      )} ${pointsWord(movement.points)}`}
      balance={balance}
      details={`${formatMovementDate(movement.createdAt)} · ${movement.operatorName}`}
      customerId={customer.id}
      customerName={customer.name}
      cancelLabel="Annulla il riscatto"
      cancelledTitle="Riscatto annullato"
      cancel={cancel}
    />
  );
}

/**
 * The reward chosen and its redemption. A refusal for good discards the operation id (useOperation)
 * and reloads what changed meanwhile: the catalog after `reward-unavailable`, the balance after
 * `insufficient-balance`. The choice only counts while the reward is in the list and within the
 * balance, so a reload that makes it unreachable clears it.
 */
function useRedeem(customerId: string, load: CustomerLoad, rewards: ActiveRewardsLoad) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Set by each answer: kept while "Riprova" is being sent, so the alert stays in place.
  const [uncertain, setUncertain] = useState<Uncertain | null>(null);
  const service = useLedgerService();
  const { reportNotEnabled } = useAuth();
  const { reload: reloadRewards } = rewards;
  const { refresh: refreshCustomer } = load;

  const balance = load.status === 'done' ? load.customer.balance : 0;
  const chosen =
    rewards.status === 'done'
      ? (rewards.rewards.find((reward) => reward.id === chosenId && reward.points <= balance) ??
        null)
      : null;

  const operation = useOperation(async (operationId) => {
    try {
      return await service.redeemReward({
        operationId,
        customerId,
        rewardId: chosen?.id ?? '',
      });
    } catch (error) {
      if (!isDefinitive(error)) {
        setUncertain(ledgerKind(error) === 'network' ? 'network' : 'server');
        throw error;
      }
      setUncertain(null);
      const kind = ledgerKind(error);
      if (kind === 'reward-unavailable') {
        setRefusal(kind);
        reloadRewards();
      } else if (kind === 'insufficient-balance') {
        setRefusal(kind);
        refreshCustomer();
      } else if (kind !== 'forbidden' && kind !== 'customer-unavailable') {
        setRefusal('invalid');
      }
      throw error;
    }
  });
  const errorKind = operation.status === 'error' ? ledgerKind(operation.error) : null;
  const forbidden = errorKind === 'forbidden';
  const customerUnavailable = errorKind === 'customer-unavailable';
  const failure =
    (operation.status === 'error' && operation.retryable) ||
    (operation.status === 'busy' && uncertain !== null)
      ? uncertain
      : null;

  useEffect(() => {
    if (forbidden) void reportNotEnabled();
  }, [forbidden, reportNotEnabled]);

  function choose(id: string) {
    setChosenId(id);
    setRefusal(null);
  }

  function submit() {
    setRefusal(null);
    void operation.submit();
  }

  return {
    balance,
    chosen,
    choose,
    submit,
    operation,
    refusal,
    failure,
    customerUnavailable,
    // While sent, and while its outcome is uncertain, the choice cannot change: "Riprova" resends
    // the same operation id, which the server ties to this reward.
    locked: operation.status === 'busy' || failure !== null,
  };
}

type Redeem = ReturnType<typeof useRedeem>;

/** One reward of CATALOGO: a radio with name and points, dashed and disabled above the balance. */
function RewardOption({ reward, redeem, name }: { reward: Reward; redeem: Redeem; name: string }) {
  const missing = reward.points - redeem.balance;
  const reachable = missing <= 0;
  return (
    <label className={styles.option} data-reachable={reachable}>
      <input
        type="radio"
        name={name}
        className={styles.radio}
        checked={redeem.chosen?.id === reward.id}
        disabled={!reachable || redeem.locked}
        onChange={() => redeem.choose(reward.id)}
      />
      <span className={styles.optionText}>
        <span className={styles.optionName}>{reward.name}</span>
        {!reachable && (
          <span className={styles.missing}>
            Mancano {formatInteger(missing)} {pointsWord(missing)}
          </span>
        )}
      </span>
      <PointsBadge points={reward.points} />
    </label>
  );
}

/** CATALOGO: loading, error with "Riprova", empty, or the active rewards in order. */
function Catalog({
  rewards,
  redeem,
  onRetry,
}: {
  rewards: ActiveRewardsLoad;
  redeem: Redeem;
  onRetry: () => void;
}) {
  if (rewards.status === 'loading') return <StatusView kind="loading" />;
  if (rewards.status === 'error') {
    return (
      <StatusView
        kind="error"
        title="Catalogo non caricato"
        description={loadErrorText(rewards.error)}
        onRetry={onRetry}
      />
    );
  }
  if (rewards.rewards.length === 0) {
    return <StatusView kind="empty" icon="gift" title="Nessun premio nel catalogo" />;
  }
  return (
    <fieldset className={styles.catalog}>
      <legend className={styles.legend}>CATALOGO</legend>
      {rewards.rewards.map((reward) => (
        <RewardOption key={reward.id} reward={reward} redeem={redeem} name="premio" />
      ))}
    </fieldset>
  );
}

/** The footer: the refusal, "Saldo dopo il riscatto N punti" and "Riscatta N punti". */
function RedeemActions({ redeem }: { redeem: Redeem }) {
  const { chosen, balance, operation, refusal, failure } = redeem;
  const busy = operation.status === 'busy';
  if (failure) {
    // "Annulla" leaves the page, and the operation id with it (as for a purchase).
    return (
      <div className={styles.buttons}>
        <ButtonLink to="/" variant="secondary" block>
          Annulla
        </ButtonLink>
        <Button block busy={busy} onClick={operation.retry}>
          {chosen
            ? `Riprova ${formatInteger(chosen.points)} ${pointsWord(chosen.points)}`
            : 'Riprova'}
        </Button>
      </div>
    );
  }
  const after = chosen ? balance - chosen.points : null;
  return (
    <div className={styles.actions}>
      {refusal && (
        <p role="alert" className={styles.refusal}>
          <Icon name="circle-alert" size={20} />
          <span>{REFUSAL_TEXT[refusal]}</span>
        </p>
      )}
      {after !== null && (
        <p className={styles.after}>
          <span>Saldo dopo il riscatto</span>
          <span className={styles.afterValue}>
            {formatInteger(after)} {pointsWord(after)}
          </span>
        </p>
      )}
      <Button block disabled={chosen === null} busy={busy} onClick={redeem.submit}>
        {chosen
          ? `Riscatta ${formatInteger(chosen.points)} ${pointsWord(chosen.points)}`
          : 'Riscatta'}
      </Button>
    </div>
  );
}

/**
 * Riscatta premio (`/clienti/:id/premi`; SPEC-ledger, points 5 and 11; wireframe "Riscatta
 * premio"): the customer row, CATALOGO from `listActive()` with the rewards above the balance
 * visible but disabled, "Premio libero", and in the footer the balance after and "Riscatta N
 * punti". One AppShell for every state, so its heading never remounts.
 */
export function RedeemPage() {
  const { id = '' } = useParams();
  const load = useCustomer(id);
  const rewards = useActiveRewards();
  const redeem = useRedeem(id, load, rewards);
  const heading = useRef<HTMLHeadingElement>(null);

  // "Riprova" gives way to the loading state: the focus goes to the title, not to <body>.
  function retryCustomer() {
    load.retry();
    heading.current?.focus();
  }
  function retryRewards() {
    rewards.reload();
    heading.current?.focus();
  }

  // The confirmation takes the place of the catalog on the same entry of the history.
  if (load.status === 'done' && redeem.operation.status === 'done') {
    return <RedeemDone customer={load.customer} result={redeem.operation.result} />;
  }

  let actions: ReactNode = null;
  let body: ReactNode;
  if (load.status === 'not-found' || redeem.customerUnavailable) {
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
  } else if (load.status === 'done' && load.customer.anonymizedAt !== null) {
    actions = (
      <ButtonLink to={`/clienti/${load.customer.id}`} block>
        Torna alla scheda
      </ButtonLink>
    );
    body = (
      <StatusView
        kind="empty"
        icon="circle-alert"
        title="Cliente cancellato: non si registrano spese né premi."
      />
    );
  } else if (load.status === 'done') {
    const withCatalog = rewards.status === 'done' && rewards.rewards.length > 0;
    actions = withCatalog || redeem.failure ? <RedeemActions redeem={redeem} /> : null;
    body = (
      <>
        <CustomerRowLink customer={load.customer} />
        {redeem.failure && (
          <LedgerFailure title={FAILURE_TITLE} text={FAILURE_TEXT[redeem.failure]} />
        )}
        <Catalog rewards={rewards} redeem={redeem} onRetry={retryRewards} />
        <Link to={`/clienti/${load.customer.id}/premi?libero`} className={styles.free}>
          <Icon name="plus" size={20} />
          <span className={styles.optionText}>
            <span className={styles.optionName}>Premio libero</span>
            <span className={styles.freeHint}>Descrizione e punti decisi al momento</span>
          </span>
          <Icon name="chevron-right" size={20} />
        </Link>
      </>
    );
  } else if (load.status === 'loading') {
    body = <StatusView kind="loading" />;
  } else {
    body = (
      <StatusView
        kind="error"
        title="Cliente non caricato"
        description={loadErrorText(load.error)}
        onRetry={retryCustomer}
      />
    );
  }

  return (
    <AppShell title={TITLE} backTo="/" backInHistory headingRef={heading} actions={actions}>
      {body}
    </AppShell>
  );
}
