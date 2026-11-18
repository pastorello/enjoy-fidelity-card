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
 * Layout route: its pages need a signed-in operator (on a device, its cashier), otherwise /accedi
 * (or /cassa on a device without a cashier). It also mounts
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
  // A device shows the pages only to its cashier (SPEC-tablet-kiosk, point 3): without one, nothing
  // here loads, the settings and the card reader included. /cassa is where the cashier is chosen.
  const operator = state.status === 'device' ? state.cashier : state.operator;
  if (!operator) return <Navigate to="/cassa" replace />;
  // Keyed by operator (on a device, its cashier): another user signing in on this device, or the
  // next cashier at the till, loads the configuration again.
  return (
    <SettingsProvider key={operator.id}>
      <CardReaderSession />
      <Outlet />
    </SettingsProvider>
  );
}
