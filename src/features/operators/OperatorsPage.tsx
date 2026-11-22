import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '../../app/AppShell';
import { ServerFaultError } from '../../lib/serverFault';
import { AdminsOnly } from '../../shared/ui/AdminsOnly';
import { StatusView } from '../../shared/ui/StatusView';
import { loadErrorText } from '../customers/loadErrorText';
import { useAuth, useCurrentOperator } from '../identity/AuthProvider';
import { OperatorRow } from './OperatorRow';
import styles from './OperatorsPage.module.css';
import { useOperatorsService } from './OperatorsServiceProvider';
import type { Operator } from './types';

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
  return error === 'unknown' ? 'Operazione non riuscita. Riprova tra poco.' : loadErrorText(error);
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

  return { state, reload };
}

/**
 * The administrators' screen (wireframe "Operatori"): the polite region of the outcomes, then the
 * list, or its loading and error states.
 */
function Operators() {
  const { state, reload } = useOperatorsList();
  // Every state renders the same AppShell, so its h1 stays mounted through loading and errors.
  const heading = useRef<HTMLHeadingElement>(null);
  // The outcome of the last action ("{nome} è disattivato."): the row actions set it.
  const [message] = useState('');

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
          <OperatorRow key={operator.id} operator={operator} />
        ))}
      </ul>
    );
  }

  return (
    <AppShell title={TITLE} backTo={BACK_TO} headingRef={heading}>
      {/* One block: the empty region adds no gap of the shell above the list. */}
      <div className={styles.content}>
        <div aria-live="polite" className={styles.messages} data-operators-messages>
          {message}
        </div>
        {content}
      </div>
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
