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
 */
export function RequireAuth() {
  const { state, retry } = useAuth();
  const location = useLocation();

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
