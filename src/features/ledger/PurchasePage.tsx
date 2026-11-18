import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { formatCents, formatInteger } from '../../shared/format';
import { Button, ButtonLink } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { StatusView } from '../../shared/ui/StatusView';
import { CustomerRowLink } from '../cards/CustomerRowLink';
import { loadErrorText } from '../customers/loadErrorText';
import type { CustomerSummary } from '../customers/types';
import { useCustomer } from '../customers/useCustomer';
import { useAuth } from '../identity/AuthProvider';
import { useSettings } from '../settings/SettingsProvider';
import type { Settings } from '../settings/types';
import { formatMovementDate, formatSignedPoints } from './formatMovement';
import { AmountKeypad } from './AmountKeypad';
import { LedgerDoneView } from './LedgerDoneView';
import { useLedgerService } from './LedgerServiceProvider';
import styles from './PurchasePage.module.css';
import { formatConfirmAmount, isUnusualAmount, pointsFor } from './points';
import { LedgerError, type LedgerResult } from './types';
import { useOperation } from './useOperation';

const TITLE = 'Registra spesa';

function pointsWord(points: number): string {
  return points === 1 ? 'punto' : 'punti';
}

/** «Punti da aggiungere +12» and «1 punto ogni 1,00 €, per difetto · nuovo saldo 132 punti». */
function PointsPreview({
  points,
  balance,
  settings,
}: {
  points: number;
  balance: number;
  settings: Settings;
}) {
  const newBalance = balance + points;
  return (
    <div className={styles.preview}>
      <p className={styles.pointsRow}>
        <span>Punti da aggiungere</span>
        <span className={styles.points}>+{formatInteger(points)}</span>
      </p>
      <p className={styles.ratio}>
        1 punto ogni {formatCents(settings.centsPerPoint)}, per difetto · nuovo saldo{' '}
        {formatInteger(newBalance)} {pointsWord(newBalance)}
      </p>
    </div>
  );
}

/**
 * «Importo insolito: +1.250 punti» / «Sopra 150,00 € l’app chiede conferma. …» (wireframe
 * "Importo insolito"): takes the place of the preview while the amount is strictly above the
 * threshold in force.
 */
function UnusualAmountWarning({ points, settings }: { points: number; settings: Settings }) {
  return (
    <div role="alert" className={styles.unusual}>
      <Icon name="triangle-alert" size={24} className={styles.unusualIcon} />
      <div>
        <p className={styles.unusualTitle}>
          Importo insolito: +{formatInteger(points)} {pointsWord(points)}
        </p>
        <p className={styles.unusualText}>
          Sopra {formatCents(settings.confirmThresholdCents)} l’app chiede conferma. Controlla di
          non aver digitato una cifra in più.
        </p>
      </div>
    </div>
  );
}

/**
 * Spesa registrata (SPEC-ledger, point 3): "+12 punti a Maria Rossi", the server's balance and
 * "12,50 € · oggi 10:42 · Giulia", all from the movement the server returned. "Annulla la spesa"
 * sends `cancelMovement` with its own operation id; `forbidden` goes back to /accedi.
 */
function PurchaseDone({ customer, result }: { customer: CustomerSummary; result: LedgerResult }) {
  const { movement, balance } = result;
  const service = useLedgerService();
  const { reportNotEnabled } = useAuth();
  const cancel = useOperation((operationId) =>
    service.cancelMovement({ operationId, movementId: movement.id }),
  );
  const forbidden =
    cancel.status === 'error' &&
    cancel.error instanceof LedgerError &&
    cancel.error.kind === 'forbidden';

  useEffect(() => {
    if (forbidden) void reportNotEnabled();
  }, [forbidden, reportNotEnabled]);

  const when = formatMovementDate(movement.createdAt);
  // "oggi 10:42" / "ieri 19:10" after the amount; "8 nov 18:05" is already lower case.
  const details = [
    movement.amountCents === null ? null : formatCents(movement.amountCents),
    when.charAt(0).toLocaleLowerCase('it-IT') + when.slice(1),
    movement.operatorName,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  return (
    <LedgerDoneView
      title="Spesa registrata"
      summary={`${formatSignedPoints(movement.points)} ${pointsWord(movement.points)} a ${customer.name}`}
      balance={balance}
      details={details}
      customerId={customer.id}
      customerName={customer.name}
      cancelLabel="Annulla la spesa"
      cancelledTitle="Spesa annullata"
      cancel={cancel}
    />
  );
}

/**
 * The purchase being typed and its recording. Called whatever the customer's state, so the page
 * keeps one AppShell (and its heading) from the loading state to the keypad.
 */
function usePurchase(customerId: string) {
  const [amountCents, setAmountCents] = useState(0);
  const settings = useSettings();
  const service = useLedgerService();
  const { reportNotEnabled } = useAuth();
  const operation = useOperation((operationId) =>
    service.recordPurchase({ operationId, customerId, amountCents }),
  );
  const forbidden =
    operation.status === 'error' &&
    operation.error instanceof LedgerError &&
    operation.error.kind === 'forbidden';

  useEffect(() => {
    if (forbidden) void reportNotEnabled();
  }, [forbidden, reportNotEnabled]);

  const points =
    settings.status === 'ready' ? pointsFor(amountCents, settings.settings.centsPerPoint) : 0;
  const unusual =
    settings.status === 'ready' &&
    isUnusualAmount(amountCents, settings.settings.confirmThresholdCents);
  return { amountCents, setAmountCents, settings, operation, forbidden, points, unusual };
}

type Purchase = ReturnType<typeof usePurchase>;

/**
 * "Riscatta premio" and "Conferma +N". Without the settings there is no "Conferma": the server's
 * ratio and threshold are needed to confirm. Above the threshold, "Correggi" (clears the amount)
 * and "Conferma 1.250 €", which records at once: no second dialog.
 */
function PurchaseActions({ customerId, purchase }: { customerId: string; purchase: Purchase }) {
  const { settings, amountCents, setAmountCents, operation, points, unusual } = purchase;
  const busy = operation.status === 'busy';
  if (unusual) {
    return (
      <div className={styles.actions}>
        <Button variant="secondary" block disabled={busy} onClick={() => setAmountCents(0)}>
          Correggi
        </Button>
        <Button block busy={busy} onClick={() => void operation.submit()}>
          Conferma {formatConfirmAmount(amountCents)}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.actions}>
      <ButtonLink to={`/clienti/${customerId}/premi`} variant="secondary" block>
        Riscatta premio
      </ButtonLink>
      {settings.status === 'ready' && (
        <Button
          block
          disabled={amountCents === 0}
          busy={busy}
          onClick={() => void operation.submit()}
        >
          Conferma +{formatInteger(points)}
        </Button>
      )}
    </div>
  );
}

/** The customer row, IMPORTO, the preview with the ratio in force (`useSettings()`), the keypad. */
function PurchaseBody({
  customer,
  purchase,
  onSettingsRetry,
}: {
  customer: CustomerSummary;
  purchase: Purchase;
  onSettingsRetry: () => void;
}) {
  const { settings, amountCents, setAmountCents, operation, forbidden, points, unusual } = purchase;
  return (
    <>
      <CustomerRowLink customer={customer} />
      <section aria-label="Importo" className={styles.amount}>
        <span className={styles.amountLabel}>IMPORTO</span>
        <output aria-live="polite" className={styles.amountFigure}>
          {formatCents(amountCents)}
        </output>
      </section>
      {settings.status === 'ready' && unusual && (
        <UnusualAmountWarning points={points} settings={settings.settings} />
      )}
      {settings.status === 'ready' && !unusual && (
        <PointsPreview points={points} balance={customer.balance} settings={settings.settings} />
      )}
      {settings.status === 'loading' && <StatusView kind="loading" />}
      {settings.status === 'error' && (
        <StatusView kind="error" title="Impostazioni non caricate" onRetry={onSettingsRetry} />
      )}
      {operation.status === 'error' && !forbidden && (
        <p role="alert" className={styles.failure}>
          Spesa non salvata: controlla la connessione e riprova.
        </p>
      )}
      <AmountKeypad value={amountCents} onChange={setAmountCents} />
    </>
  );
}

/**
 * Registra spesa (`/clienti/:id/spesa`; SPEC-ledger, points 1 and 11; wireframe "Registra spesa"),
 * opened by an active card on the home or from the customer page. A `not_operator` refusal while
 * loading the customer, or `forbidden` from the ledger, goes back to /accedi (`reportNotEnabled`).
 * One AppShell for every state, so its heading never remounts.
 */
export function PurchasePage() {
  const { id = '' } = useParams();
  const load = useCustomer(id);
  const purchase = usePurchase(id);
  const heading = useRef<HTMLHeadingElement>(null);

  // "Riprova" gives way to the loading state: the focus goes to the title, not to <body>.
  function retryCustomer() {
    load.retry();
    heading.current?.focus();
  }
  function retrySettings() {
    if (purchase.settings.status === 'error') purchase.settings.retry();
    heading.current?.focus();
  }

  // The confirmation takes the place of the keypad on the same entry of the history: the system
  // back from it goes where the keypad would have, never back to the keypad.
  if (load.status === 'done' && purchase.operation.status === 'done') {
    return <PurchaseDone customer={load.customer} result={purchase.operation.result} />;
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
    actions = <PurchaseActions customerId={load.customer.id} purchase={purchase} />;
    body = (
      <PurchaseBody customer={load.customer} purchase={purchase} onSettingsRetry={retrySettings} />
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
