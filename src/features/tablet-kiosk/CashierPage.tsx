import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { Icon } from '../../shared/ui/Icon';
import { StatusView } from '../../shared/ui/StatusView';
import { ServerFaultError } from '../../lib/serverFault';
import { useBlockedKeys } from '../card-input/useBlockedKeys';
import { NOT_IN_DISPLAY } from '../cards/customerName';
import { loadErrorText } from '../customers/loadErrorText';
import { useAuth } from '../identity/AuthProvider';
import { useKioskService } from './KioskServiceProvider';
import { PinPad } from './PinPad';
import { lockText, usePinLock, wrongPinText } from './pinLock';
import { turnEndedIn } from './RequireCashier';
import { KioskError, type Cashier } from './types';
import { useTabletLayout } from './useTabletLayout';
import styles from './CashierPage.module.css';

const PAGE_TITLE = 'Chi è alla cassa?';
const CHOOSE_TITLE = 'Tocca il tuo nome';
const NETWORK_TEXT = 'Connessione assente. Riprova.';
const NO_PIN_TEXT = 'PIN da impostare dal telefono';

type List =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; cashiers: Cashier[] };

/** What the last check said; the lock has its own state, as it outlives a change of name. */
type Feedback =
  | { kind: 'wrong-pin'; attemptsLeft: number }
  | { kind: 'no-pin' }
  | { kind: 'network' }
  | { kind: 'failure'; error: unknown };

function feedbackText(feedback: Feedback): string {
  if (feedback.kind === 'wrong-pin') {
    return wrongPinText(feedback.attemptsLeft);
  }
  if (feedback.kind === 'no-pin') return NO_PIN_TEXT;
  if (feedback.kind === 'network') return NETWORK_TEXT;
  return feedback.error instanceof ServerFaultError
    ? loadErrorText(feedback.error)
    : 'PIN non verificato. Riprova.';
}

const ROLE_LABEL = { admin: 'Amministratore', operator: 'Operatore' } as const;

function byName(a: Cashier, b: Cashier): number {
  return a.name.localeCompare(b.name, 'it-IT', { sensitivity: 'base' });
}

function initialOf(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase('it-IT');
}

/**
 * /cassa, "Chi è alla cassa?" (SPEC-tablet-kiosk, point 3; wireframe "Tablet: cambio operatore"):
 * only for device accounts, an operator's own account goes to the home. The operators in
 * alphabetical order, none chosen; the PIN, typed only by touch, is checked by the server at the
 * 4th digit and lives only in this page's state. Every key is stopped while the page is up, so
 * neither a card reader nor a focused button can type or press anything; card reading is off
 * here anyway (no `CardReaderSession` outside `RequireCashier`). A right PIN reads the identity
 * again (the cashier and the turn) and goes to the home.
 */
export function CashierPage() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status !== 'device') return <Navigate to="/" replace />;
  return (
    <CashierChooser turnEnded={turnEndedIn(location.state)} lockSeconds={state.lockSecondsLeft} />
  );
}

function CashierChooser({ turnEnded, lockSeconds }: { turnEnded: boolean; lockSeconds: number }) {
  useBlockedKeys();
  const kiosk = useKioskService();
  const { refreshIdentity, reportNotEnabled } = useAuth();
  const navigate = useNavigate();
  const tablet = useTabletLayout();
  const [list, setList] = useState<List>({ status: 'loading' });
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const { secondsLeft, lockFor } = usePinLock(lockSeconds);
  const locked = secondsLeft > 0;

  const load = useCallback(
    () =>
      kiosk.listCashiers().then(
        (cashiers) => setList({ status: 'ready', cashiers: cashiers.toSorted(byName) }),
        (error: unknown) => setList({ status: 'error', error }),
      ),
    [kiosk],
  );

  useEffect(() => {
    void load();
    // The lock in the identity may be from an earlier reading: read it again on arrival.
    void refreshIdentity();
  }, [load, refreshIdentity]);

  const cashiers = list.status === 'ready' ? list.cashiers : [];
  const chosen = cashiers.find((cashier) => cashier.id === chosenId && cashier.hasPin) ?? null;

  function choose(cashier: Cashier) {
    if (checking) return;
    setChosenId(cashier.id);
    setPin('');
    setFeedback(null);
  }

  async function check(operatorId: string, entered: string) {
    setChecking(true);
    setFeedback(null);
    let result;
    try {
      result = await kiosk.unlock(operatorId, entered);
    } catch (error) {
      setPin('');
      setChecking(false);
      setFeedback({ kind: 'failure', error });
      // Not a device any more (42501): the identity check decides where to go.
      if (error instanceof KioskError && error.kind === 'forbidden') void reportNotEnabled();
      return;
    }
    if (result.status === 'ok') {
      await refreshIdentity();
      await navigate('/', { replace: true });
      return;
    }
    setPin('');
    setChecking(false);
    switch (result.status) {
      case 'wrong-pin':
        setFeedback({ kind: 'wrong-pin', attemptsLeft: result.attemptsLeft });
        break;
      case 'locked':
        lockFor(result.lockSecondsLeft);
        break;
      case 'no-pin':
        // The PIN was removed meanwhile: shown as the others without one.
        setList((current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                cashiers: current.cashiers.map((cashier) =>
                  cashier.id === operatorId ? { ...cashier, hasPin: false } : cashier,
                ),
              }
            : current,
        );
        setChosenId(null);
        setFeedback({ kind: 'no-pin' });
        break;
      case 'network':
        setFeedback({ kind: 'network' });
        break;
    }
  }

  const ready = list.status === 'ready' && cashiers.some((cashier) => cashier.hasPin);

  /** What the left column shows under the title: a state, or the operators to choose from. */
  function chooser() {
    if (list.status === 'loading') return <StatusView kind="loading" />;
    if (list.status === 'error') {
      return (
        <StatusView
          kind="error"
          title="Operatori non caricati"
          description={loadErrorText(list.error)}
          onRetry={() => {
            setList({ status: 'loading' });
            void load();
          }}
        />
      );
    }
    if (!ready) {
      return (
        <StatusView
          kind="empty"
          icon="lock"
          title="Nessuno ha ancora impostato il PIN: ognuno lo imposta dal proprio telefono, in Impostazioni"
        />
      );
    }
    return (
      <>
        <fieldset aria-label="Operatori" className={styles.operators}>
          {cashiers.map((cashier) => (
            <button
              key={cashier.id}
              type="button"
              aria-pressed={cashier.id === chosen?.id}
              disabled={!cashier.hasPin || checking}
              className={styles.operator}
              onClick={() => choose(cashier)}
            >
              <span
                aria-hidden="true"
                className={styles.initial}
                data-body-font={NOT_IN_DISPLAY.test(cashier.name)}
              >
                {initialOf(cashier.name)}
              </span>
              <span className={styles.name} data-body-font={NOT_IN_DISPLAY.test(cashier.name)}>
                {cashier.name}
              </span>
              <span className={styles.role}>{ROLE_LABEL[cashier.role]}</span>
              {!cashier.hasPin && <span className={styles.role}>{NO_PIN_TEXT}</span>}
            </button>
          ))}
        </fieldset>
        <p className={styles.explanation}>
          Sul tablet condiviso si cambia operatore con il PIN personale di 4 cifre. Spese e riscatti
          vengono registrati a nome di chi è alla cassa.
        </p>
      </>
    );
  }

  return (
    <AppShell>
      <div className={styles.layout} data-tablet={tablet}>
        <div className={styles.chooser}>
          <h2 className={styles.pageTitle}>{PAGE_TITLE}</h2>
          {turnEnded && (
            <p className={styles.notice}>
              <Icon name="lock" size={20} />
              Turno scaduto: inserisci di nuovo il PIN
            </p>
          )}
          {chooser()}
        </div>
        {ready && (
          <aside aria-label="PIN" className={styles.pinPanel}>
            <PinPad
              heading={
                <h2
                  className={styles.pinTitle}
                  data-body-font={chosen !== null && NOT_IN_DISPLAY.test(chosen.name)}
                >
                  {chosen ? `PIN di ${chosen.name}` : CHOOSE_TITLE}
                </h2>
              }
              value={pin}
              onChange={setPin}
              onComplete={(entered) => {
                if (chosen) void check(chosen.id, entered);
              }}
              disabled={chosen === null || checking || locked}
            />
            {locked ? (
              <p role="timer" className={styles.message}>
                {lockText(secondsLeft)}
              </p>
            ) : (
              feedback && (
                <p role="alert" className={styles.message}>
                  <Icon name="circle-alert" size={20} />
                  {feedbackText(feedback)}
                </p>
              )
            )}
            <p className={styles.note}>Dopo 5 PIN errati il cambio si blocca per qualche minuto.</p>
          </aside>
        )}
      </div>
    </AppShell>
  );
}
