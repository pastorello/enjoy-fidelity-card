import { Navigate, useLocation } from 'react-router';
import { AppShell } from '../../app/AppShell';
import { StatusView } from '../../shared/ui/StatusView';
import { useAuth } from '../identity/AuthProvider';
import { turnEndedIn } from './RequireCashier';

/**
 * /cassa, "Chi è alla cassa?" (SPEC-tablet-kiosk, point 3): only for device accounts; an operator's
 * own account goes to the home. Card reading is off here (no `CardReaderSession` outside
 * `RequireCashier`). The operator choice and the PIN pad come with the next tasks of the module.
 */
export function CashierPage() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status !== 'device') return <Navigate to="/" replace />;
  const turnEnded = turnEndedIn(location.state);
  return (
    <AppShell title="Chi è alla cassa?">
      {turnEnded && (
        <StatusView kind="empty" icon="lock" title="Turno scaduto: inserisci di nuovo il PIN" />
      )}
    </AppShell>
  );
}
