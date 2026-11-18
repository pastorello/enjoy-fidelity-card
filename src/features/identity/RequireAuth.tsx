import { Navigate, Outlet, useLocation } from 'react-router';
import { StatusView } from '../../shared/ui/StatusView';
import { CardReaderSession } from '../card-input/CardReaderSession';
import { SettingsProvider } from '../settings/SettingsProvider';
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
 * Layout route: its pages need a signed-in operator, otherwise /accedi. It also mounts
 * <SettingsProvider>, so the configuration loads once per session and never without an operator,
 * and <CardReaderSession>, so cards are read only with an operator (SPEC-card-input, point 2).
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
  // Keyed by operator: another user signing in on this device loads the configuration again.
  return (
    <SettingsProvider key={state.operator.id}>
      <CardReaderSession />
      <Outlet />
    </SettingsProvider>
  );
}
