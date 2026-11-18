import { useEffect, useId, useState } from 'react';
import { formatInteger } from '../../shared/format';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { TextField } from '../../shared/ui/TextField';
import { firstName } from '../cards/customerName';
import type { CustomerSummary } from '../customers/types';
import type { CustomerLoad } from '../customers/useCustomer';
import { useAuth } from '../identity/AuthProvider';
import { AmountKeypad } from './AmountKeypad';
import styles from './FreeRewardForm.module.css';
import { useLedgerService } from './LedgerServiceProvider';
import { LedgerError } from './types';
import { isDefinitive, useOperation } from './useOperation';

/** `app.redeem_free_reward`: the description is 1..80 characters once the outer spaces are gone. */
export const FREE_REWARD_DESCRIPTION_MAX = 80;

/** No answer (network, or none within 8 s) or a fault of the server: "Riprova" resends the id. */
export type FreeRewardUncertain = 'network' | 'server';

const INVALID_TEXT = 'Riscatto non registrato: dati non validi. Ricomincia.';

function ledgerKind(error: unknown) {
  return error instanceof LedgerError ? error.kind : null;
}

function pointsWord(points: number): string {
  return points === 1 ? 'punto' : 'punti';
}

/** The description as the server keeps it: without the outer spaces. */
function cleanDescription(description: string): string {
  return description.trim();
}

/**
 * The free reward being typed and its redemption (SPEC-ledger, point 6). The server checks
 * everything again; here "Riscatta" waits for a description, at least 1 point and enough balance.
 * `insufficient-balance` (the balance changed meanwhile) reloads the customer, so the warning
 * shows the new balance; any other refusal for good asks to start again.
 */
export function useFreeReward(customerId: string, load: CustomerLoad) {
  const [description, setDescription] = useState('');
  const [points, setPoints] = useState(0);
  const [invalid, setInvalid] = useState(false);
  // Set by each answer: kept while "Riprova" is being sent, so the alert stays in place.
  const [uncertain, setUncertain] = useState<FreeRewardUncertain | null>(null);
  const service = useLedgerService();
  const { reportNotEnabled } = useAuth();
  const { refresh: refreshCustomer } = load;

  const operation = useOperation(async (operationId) => {
    try {
      return await service.redeemFreeReward({
        operationId,
        customerId,
        description: cleanDescription(description),
        points,
      });
    } catch (error) {
      if (!isDefinitive(error)) {
        setUncertain(ledgerKind(error) === 'network' ? 'network' : 'server');
        throw error;
      }
      setUncertain(null);
      const kind = ledgerKind(error);
      if (kind === 'insufficient-balance') refreshCustomer();
      else if (kind !== 'forbidden' && kind !== 'customer-unavailable') setInvalid(true);
      throw error;
    }
  });
  const errorKind = operation.status === 'error' ? ledgerKind(operation.error) : null;
  const forbidden = errorKind === 'forbidden';
  const failure =
    (operation.status === 'error' && operation.retryable) ||
    (operation.status === 'busy' && uncertain !== null)
      ? uncertain
      : null;

  useEffect(() => {
    if (forbidden) void reportNotEnabled();
  }, [forbidden, reportNotEnabled]);

  const balance = load.status === 'done' ? load.customer.balance : 0;
  const insufficient = points > balance;
  const cleanLength = Array.from(cleanDescription(description)).length;
  const ready =
    cleanLength >= 1 && cleanLength <= FREE_REWARD_DESCRIPTION_MAX && points > 0 && !insufficient;

  // While sent, and while its outcome is uncertain, the values cannot change: "Riprova" resends
  // the same operation id, which the server ties to this description and these points.
  const locked = operation.status === 'busy' || failure !== null;

  function changeDescription(next: string) {
    if (locked) return;
    setDescription(next);
    setInvalid(false);
  }
  function changePoints(next: number) {
    if (locked) return;
    setPoints(next);
    setInvalid(false);
  }

  return {
    description,
    changeDescription,
    points,
    changePoints,
    insufficient,
    ready,
    operation,
    invalid,
    failure,
    customerUnavailable: errorKind === 'customer-unavailable',
    locked,
  };
}

export type FreeReward = ReturnType<typeof useFreeReward>;

/**
 * Premio libero (wireframe "Premio libero"): "Descrizione del premio", PUNTI DA SCALARE with the
 * points keypad (no "00", 56 px keys) and, above the balance, "Saldo insufficiente: Maria ha 120
 * punti …" tied to the figure. The customer row and the uncertain-outcome panel are the page's.
 */
export function FreeRewardForm({
  customer,
  free,
}: {
  customer: CustomerSummary;
  free: FreeReward;
}) {
  const alertId = useId();
  const { insufficient, locked, failure } = free;
  return (
    <>
      <TextField
        label="Descrizione del premio"
        placeholder="Es. dolce del giorno"
        value={free.description}
        onChange={free.changeDescription}
        maxLength={FREE_REWARD_DESCRIPTION_MAX}
        autoComplete="off"
        readOnly={locked}
      />
      <section aria-label="Punti da scalare" className={styles.points}>
        <div className={styles.pointsRow} data-insufficient={insufficient}>
          <span className={styles.pointsLabel}>PUNTI DA SCALARE</span>
          <output
            aria-live="polite"
            aria-describedby={insufficient ? alertId : undefined}
            className={styles.pointsFigure}
          >
            {formatInteger(free.points)}
          </output>
        </div>
        {insufficient && (
          <p id={alertId} role="alert" className={styles.alert}>
            <Icon name="circle-alert" size={20} />
            <span>
              Saldo insufficiente: {firstName(customer.name)} ha {formatInteger(customer.balance)}{' '}
              {pointsWord(customer.balance)} e il saldo non può scendere sotto zero.
            </span>
          </p>
        )}
      </section>
      {free.invalid && (
        <p role="alert" className={styles.alert}>
          <Icon name="circle-alert" size={20} />
          <span>{INVALID_TEXT}</span>
        </p>
      )}
      {!failure && (
        <AmountKeypad variant="points" value={free.points} onChange={free.changePoints} />
      )}
    </>
  );
}

/** The footer: "Riscatta N punti" ("Riscatta" at 0); "Annulla" and "Riprova" after no answer. */
export function FreeRewardActions({ free }: { free: FreeReward }) {
  const { operation, points } = free;
  const busy = operation.status === 'busy';
  const label = points > 0 ? `Riscatta ${formatInteger(points)} ${pointsWord(points)}` : 'Riscatta';
  if (free.failure) {
    // "Annulla" leaves the page, and the operation id with it (as for a purchase).
    return (
      <div className={styles.buttons}>
        <ButtonLink to="/" variant="secondary" block>
          Annulla
        </ButtonLink>
        <Button block busy={busy} onClick={operation.retry}>
          {`Riprova ${formatInteger(points)} ${pointsWord(points)}`}
        </Button>
      </div>
    );
  }
  return (
    <Button block disabled={!free.ready} busy={busy} onClick={() => void operation.submit()}>
      {label}
    </Button>
  );
}
