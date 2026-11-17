import { Navigate, Outlet, useLocation } from 'react-router';
import { StatusView } from '../../shared/ui/StatusView';
import { useAuth } from './AuthProvider';
import styles from './RequireAuth.module.css';

/** Location state of /accedi: the page to go back to after signing in. */
export type SignInLocationState = { from?: string };

/** Layout route: its pages need a signed-in operator, otherwise /accedi. */
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
          description="Controlla la connessione e riprova."
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
