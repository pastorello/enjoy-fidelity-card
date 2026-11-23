import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '../../app/AppShell';
import { ServerFaultError } from '../../lib/serverFault';
import { AdminsOnly } from '../../shared/ui/AdminsOnly';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { StatusView } from '../../shared/ui/StatusView';
import { NOT_IN_DISPLAY } from '../cards/customerName';
import { loadErrorText } from '../customers/loadErrorText';
import { useAuth, useCurrentOperator, useDevice } from '../identity/AuthProvider';
import { TabletColumns } from '../tablet-kiosk/TabletColumns';
import { useTabletLayout } from '../tablet-kiosk/useTabletLayout';
import { AdminPinDialog } from './AdminPinDialog';
import { InviteForm } from './InviteForm';
import { OperatorDialog } from './OperatorDialog';
import { OperatorRow, type RowAction, type RowFocus } from './OperatorRow';
import { ADMIN_PIN_MISSING, GENERIC_ERROR, LAST_ADMIN_ERROR, SELF_ERROR } from './operatorTexts';
import styles from './OperatorsPage.module.css';
import { useOperatorsService } from './OperatorsServiceProvider';
import type { ActiveResult, Operator, PinRefusal } from './types';

const TITLE = 'Operatori';
const BACK_TO = '/impostazioni';
const ADMINS_ONLY = 'Gli operatori li gestiscono gli amministratori.';

type ListFailure = 'network' | 'unknown' | ServerFaultError;

type ListState =
  | { status: 'loading' }
  | { status: 'error'; error: ListFailure }
  | { status: 'forbidden' }
  | { status: 'done'; operators: Operator[] };

/** "Operatori non caricati": the words of sign-in for the network and the server (SPEC point 2). */
function listErrorText(error: ListFailure): string {
  return error === 'unknown' ? GENERIC_ERROR : loadErrorText(error);
}

/**
 * The people from `app.list_operators`, in the server's order (never sorted here). `reload` asks
 * again: after an error it shows the loading state, otherwise the list stays until the answer. Only
 * the last request's answer is shown. A `forbidden` answer (role lost, account deactivated) is
 * reported to AuthProvider, which checks the identity again.
 */
function useOperatorsList() {
  const service = useOperatorsService();
  const { reportNotEnabled } = useAuth();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const latest = useRef(0);

  const load = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    service.list().then(
      (result) => {
        if (latest.current !== request) return;
        if (result.status === 'ok') {
          setState({ status: 'done', operators: result.operators });
        } else if (result.status === 'forbidden') {
          setState({ status: 'forbidden' });
          void reportNotEnabled();
        } else {
          const error = result.status;
          setState((shown) => (shown.status === 'done' ? shown : { status: 'error', error }));
        }
      },
      (error: unknown) => {
        if (latest.current !== request) return;
        // The service rejects only with a server fault; anything else reads as "unknown".
        const failure = error instanceof ServerFaultError ? error : 'unknown';
        setState((shown) =>
          shown.status === 'done' ? shown : { status: 'error', error: failure },
        );
      },
    );
  }, [service, reportNotEnabled]);

  useEffect(() => {
    load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  const reload = useCallback(() => {
    setState((shown) => (shown.status === 'error' ? { status: 'loading' } : shown));
    load();
  }, [load]);

  /** An action was refused with `forbidden`: the same as a refused list. */
  const forbid = useCallback(() => {
    latest.current += 1;
    setState({ status: 'forbidden' });
    void reportNotEnabled();
  }, [reportNotEnabled]);

  return { state, reload, forbid };
}

type ChangeFailure = Exclude<ActiveResult['status'], 'ok' | 'forbidden' | PinRefusal['status']>;

/**
 * SPEC-operators point 6: errors stay in the dialog. `upstream` and anything else (no answer, a
 * profile gone or without an account meanwhile, a server fault) get the generic text.
 */
const CHANGE_ERROR: Record<ChangeFailure, string> = {
  'last-admin': LAST_ADMIN_ERROR,
  self: SELF_ERROR,
  // EO005: a deactivated admin reactivated from a device without the PIN (never asked so).
  'admin-from-device': ADMIN_PIN_MISSING,
  'no-account': GENERIC_ERROR,
  'not-found': GENERIC_ERROR,
  network: GENERIC_ERROR,
  unknown: GENERIC_ERROR,
};

/** Refusals that mean the list on screen is stale: it is asked again behind the dialog. */
const STALE: ReadonlySet<ChangeFailure> = new Set(['no-account', 'not-found']);

/** The texts of the two confirmations (SPEC-operators point 2). */
const CONFIRM = {
  deactivate: {
    title: 'Disattivare',
    description:
      'Non potrà più accedere all’app. I suoi movimenti restano nello storico; puoi riattivarlo quando vuoi.',
    confirmLabel: 'Disattiva',
    tone: 'danger',
    done: (name: string) => `${name} è disattivato.`,
  },
  reactivate: {
    title: 'Riattivare',
    description: 'Potrà di nuovo accedere con la sua password.',
    confirmLabel: 'Riattiva',
    tone: 'primary',
    done: (name: string) => `${name} è di nuovo attivo.`,
  },
} as const;

type Pending = { operator: Operator; action: RowAction };

/**
 * "Disattiva" / "Riattiva" with their `ConfirmDialog`: one request at a time (a double tap sends
 * one), errors in the dialog, which stays open to try again (the change is idempotent). Done: the
 * dialog closes, the outcome goes to the live region and the list is asked again from the server.
 * On a device, reactivating a deactivated admin asks the cashier's PIN once confirmed (`asking`,
 * "Conferma con il PIN", Open Questions 11): a refused PIN stays there; any other failure goes back
 * to the confirmation with its text.
 */
function useActiveChange({
  onDone,
  onStale,
  onForbidden,
}: {
  onDone: (operator: Operator, message: string) => void;
  onStale: () => void;
  onForbidden: () => void;
}) {
  const service = useOperatorsService();
  const onDevice = useDevice() !== null;
  const [pending, setPending] = useState<Pending | null>(null);
  const [asking, setAsking] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  // Set synchronously, so a second tap in the same frame is ignored before `busy` renders.
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function send({ operator, action }: Pending, pin?: string): Promise<PinRefusal | null> {
    let result: ActiveResult;
    try {
      const active = action === 'reactivate';
      result = await (pin === undefined
        ? service.setActive(operator.id, active)
        : service.setActive(operator.id, active, pin));
    } catch {
      // A server fault (`ServerFaultError`): "altro" in the table of point 6.
      result = { status: 'unknown' };
    }
    sending.current = false;
    setBusy(false);
    if (result.status === 'wrong-pin' || result.status === 'pin-locked') return result;
    if (pin !== undefined) {
      setAsking(null);
      // Back to the confirmation, where the error is told and a new tap asks the PIN again.
      if (result.status !== 'ok' && result.status !== 'forbidden') setPending({ operator, action });
    }
    if (result.status === 'ok') {
      setPending(null);
      onDone(operator, CONFIRM[action].done(operator.name));
    } else if (result.status === 'forbidden') {
      setPending(null);
      onForbidden();
    } else {
      setError(CHANGE_ERROR[result.status]);
      if (STALE.has(result.status)) onStale();
    }
    return null;
  }

  return {
    pending,
    asking,
    busy,
    error,
    open: (operator: Operator, action: RowAction) => {
      setError(null);
      setPending({ operator, action });
    },
    confirm: () => {
      if (sending.current || pending === null) return;
      if (onDevice && pending.action === 'reactivate' && pending.operator.role === 'admin') {
        setError(null);
        setPending(null);
        setAsking(pending);
        return;
      }
      sending.current = true;
      setBusy(true);
      setError(null);
      void send(pending);
    },
    cancel: () => {
      if (sending.current) return;
      setPending(null);
      setError(null);
    },
    /** The PIN of "Conferma con il PIN": sent with the reactivation it confirms. */
    sendPin: (pin: string): Promise<PinRefusal | null> => {
      if (sending.current || asking === null) return Promise.resolve(null);
      sending.current = true;
      setBusy(true);
      return send(asking, pin);
    },
    closePin: () => {
      if (!sending.current) setAsking(null);
    },
  };
}

/** A name with a glyph Enjoy Display lacks is set in the body font inside the title. */
function TitleName({ name }: { name: string }) {
  return <span className={NOT_IN_DISPLAY.test(name) ? styles.typedName : undefined}>{name}</span>;
}

/**
 * The administrators' screen (wireframe "Operatori"): the polite region of the outcomes, then the
 * list, or its loading and error states; "Invita operatore" in the footer, on the raised surface.
 * On the tablet layout (wireframe "Tablet: operatori") the list stays on the left and "Invita
 * operatore" goes to the 480 px column on the right, from the top.
 */
function Operators() {
  const tablet = useTabletLayout();
  const { state, reload, forbid } = useOperatorsList();
  // Every state renders the same AppShell, so its h1 stays mounted through loading and errors.
  const heading = useRef<HTMLHeadingElement>(null);
  // The outcome of the last action ("{nome} è disattivato."): the row actions set it.
  const [message, setMessage] = useState('');
  // The row of the last action done, and which of its controls: it keeps the focus through the
  // reload.
  const [focused, setFocused] = useState<{ id: string; target: RowFocus } | null>(null);
  // The person whose dialog is open (a snapshot, followed by the reloaded list).
  const [person, setPerson] = useState<Operator | null>(null);
  const change = useActiveChange({
    onDone(operator, text) {
      setMessage(text);
      setFocused({ id: operator.id, target: 'action' });
      reload();
    },
    onStale: reload,
    onForbidden: forbid,
  });
  const confirmTexts = change.pending === null ? null : CONFIRM[change.pending.action];
  const shownPerson =
    person === null
      ? null
      : ((state.status === 'done'
          ? state.operators.find((operator) => operator.id === person.id)
          : undefined) ?? person);

  // "Riprova" is replaced by the loading state: the focus goes to the title, not to <body>.
  function retry() {
    reload();
    heading.current?.focus();
  }

  if (state.status === 'forbidden') {
    return <AdminsOnly title={TITLE} description={ADMINS_ONLY} />;
  }

  let content;
  if (state.status === 'loading') {
    content = <StatusView kind="loading" />;
  } else if (state.status === 'error') {
    content = (
      <StatusView
        kind="error"
        title="Operatori non caricati"
        description={listErrorText(state.error)}
        onRetry={retry}
      />
    );
  } else {
    // Never empty: the person looking at it is in it.
    content = (
      <ul className={styles.list} aria-label="Operatori del bar">
        {state.operators.map((operator) => (
          <OperatorRow
            key={operator.id}
            operator={operator}
            focus={focused?.id === operator.id ? focused.target : undefined}
            onAction={(target, action) => {
              setFocused(null);
              change.open(target, action);
            }}
            onOpen={(target) => {
              setFocused(null);
              setPerson(target);
            }}
          />
        ))}
      </ul>
    );
  }

  const form = (
    <InviteForm
      disabled={state.status === 'loading'}
      onInvited={(operator) => {
        setMessage(`Invito inviato a ${operator.name}.`);
        setFocused(null);
        reload();
      }}
      onForbidden={forbid}
    />
  );

  // One block: the empty region adds no gap of the shell above the list.
  const main = (
    <div className={styles.content}>
      <div aria-live="polite" className={styles.messages} data-operators-messages>
        {message}
      </div>
      {content}
    </div>
  );

  const dialogs = (
    <>
      <ConfirmDialog
        open={change.pending !== null}
        tone={confirmTexts?.tone ?? 'primary'}
        title={
          change.pending && (
            <>
              {confirmTexts?.title} <TitleName name={change.pending.operator.name} />?
            </>
          )
        }
        description={confirmTexts?.description}
        confirmLabel={confirmTexts?.confirmLabel ?? ''}
        busy={change.busy}
        error={change.error}
        onConfirm={change.confirm}
        onCancel={change.cancel}
      />
      <AdminPinDialog
        open={change.asking !== null}
        question={`Per riattivare ${change.asking?.operator.name ?? ''}, amministratore, dal tablet serve il tuo PIN.`}
        onPin={change.sendPin}
        onClose={change.closePin}
      />
      {shownPerson && (
        <OperatorDialog
          key={shownPerson.id}
          operator={shownPerson}
          onDone={(operator, text) => {
            setPerson(null);
            setMessage(text);
            setFocused({ id: operator.id, target: 'person' });
            reload();
          }}
          onStale={reload}
          onForbidden={() => {
            setPerson(null);
            forbid();
          }}
          onClose={() => setPerson(null)}
        />
      )}
    </>
  );

  if (tablet) {
    return (
      <AppShell title={TITLE} backTo={BACK_TO} headingRef={heading}>
        <TabletColumns column="invite-operator" width={480} label="Invita operatore" aside={form}>
          {main}
        </TabletColumns>
        {dialogs}
      </AppShell>
    );
  }

  return (
    <AppShell
      title={TITLE}
      backTo={BACK_TO}
      headingRef={heading}
      actions={form}
      actionsTone="raised"
    >
      {main}
      {dialogs}
    </AppShell>
  );
}

/**
 * /impostazioni/operatori (SPEC-operators point 2). An operator who opens it by hand gets the
 * "solo amministratori" view and nothing is asked of the server.
 */
export function OperatorsPage() {
  const operator = useCurrentOperator();
  if (operator.role !== 'admin') {
    return <AdminsOnly title={TITLE} description={ADMINS_ONLY} />;
  }
  return <Operators />;
}
