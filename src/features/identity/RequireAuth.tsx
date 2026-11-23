import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { StatusView } from '../../shared/ui/StatusView';
import { useAuth } from './AuthProvider';
import styles from './RequireAuth.module.css';

const errorDescriptions = {
  network: 'Controlla la connessione e riprova.',
  misconfigured: 'Servizio non configurato: chiedi a un amministratore.',
  unavailable: 'Servizio momentaneamente non disponibile: riprova tra poco.',
} as const;

/** Location state of /accedi: the page to go back to after signing in. */
export type SignInLocationState = { from?: string };

/**
 * Layout route: its pages need a signed-in account (an operator, or a device such as the till
 * tablet), otherwise /accedi. Inside it, `RequireCashier` guards the pages that also need an
 * operator at work (on a device, its cashier) and mounts the settings and the card reader; /cassa,
 * where the cashier is chosen, stays outside that guard.
 *
 * An administrator can deactivate an operator account or change its role while the app is open
 * (SPEC-operators, point 7): at every route change after the first page (whose identity was just
 * checked) the operator's identity is read again, without blocking the page. Not enabled any more
 * → /accedi with "Account non abilitato…"; another role → the session is updated; offline →
 * nothing changes. A device is re-checked by `RequireCashier`, as before.
 */
export function RequireAuth() {
  const { state, retry, refreshIdentity } = useAuth();
  const location = useLocation();
  const isOperator = state.status === 'signed-in';
  const routeKey = location.key;
  // The route already seen by an operator session: null until its first page.
  const seenRoute = useRef<string | null>(null);

  useEffect(() => {
    if (!isOperator) {
      seenRoute.current = null;
      return;
    }
    if (seenRoute.current === routeKey) return;
    const first = seenRoute.current === null;
    seenRoute.current = routeKey;
    if (!first) void refreshIdentity();
  }, [isOperator, routeKey, refreshIdentity]);

  if (state.status === 'loading') {
    return (
      <div className={styles.screen}>
        <StatusView kind="loading" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={styles.screen}>
        <StatusView
          kind="error"
          title="Impossibile caricare il tuo account"
          description={errorDescriptions[state.fault ?? 'network']}
          onRetry={() => void retry()}
        />
      </div>
    );
  }
  if (state.status === 'signed-out') {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/accedi" replace state={{ from } satisfies SignInLocationState} />;
  }
  return <Outlet />;
}
