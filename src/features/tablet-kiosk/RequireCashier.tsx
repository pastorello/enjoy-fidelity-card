import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { CardReaderSession } from '../card-input/CardReaderSession';
import { useAuth } from '../identity/AuthProvider';
import { SettingsProvider } from '../settings/SettingsProvider';

/** Location state of /cassa: the turn of the cashier who was at the till has ended. */
export type CashierLocationState = { turnEnded?: boolean };

/** The longest delay `setTimeout` keeps (about 24.8 days); a longer one would fire at once. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Layout route inside `RequireAuth`: its pages need an operator, and on a device a cashier whose
 * turn is running (SPEC-tablet-kiosk, point 5). A device without one goes to /cassa, with "Turno
 * scaduto" when a cashier was at the till. Because a read after the turn returns 0 rows rather than
 * an error, on a device the identity is read again at every route change (the foreground and the
 * "not an operator" refusals are re-checked by `AuthProvider`), and the turn ends at the time the
 * server gave even when that read fails, so the till never stays open past it.
 *
 * It mounts `SettingsProvider` and `CardReaderSession`, keyed by the operator (on a device, its
 * cashier): the configuration loads once per operator and never without one, and cards are read
 * only here, never on /cassa (SPEC-card-input, point 2; SPEC-tablet-kiosk, point 8).
 */
export function RequireCashier() {
  const { state, refreshIdentity } = useAuth();
  const routeKey = useLocation().key;
  const isDevice = state.status === 'device';
  const operator =
    state.status === 'device'
      ? state.cashier
      : state.status === 'signed-in'
        ? state.operator
        : null;
  const expiresAt = state.status === 'device' ? (state.turnExpiresAt?.getTime() ?? null) : null;
  // Mounted with a cashier: losing it later means the turn ended under their hands.
  const [startedWithCashier] = useState(operator !== null);
  // The end of a turn whose time has come by this device's clock.
  const [endedAt, setEndedAt] = useState<number | null>(null);
  // The route whose arrival was already checked with the server.
  const checkedRoute = useRef<string | null>(null);

  useEffect(() => {
    if (!isDevice || checkedRoute.current === routeKey) return;
    checkedRoute.current = routeKey;
    void refreshIdentity();
  }, [isDevice, routeKey, refreshIdentity]);

  useEffect(() => {
    if (expiresAt === null) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const wait = () => {
      const left = expiresAt - Date.now();
      if (left > 0) {
        // Capped, so a far end does not fire at once; it waits again when woken early.
        timer = setTimeout(wait, Math.min(left, MAX_TIMEOUT_MS));
        return;
      }
      setEndedAt(expiresAt);
      void refreshIdentity();
    };
    timer = setTimeout(wait, 0);
    return () => clearTimeout(timer);
  }, [expiresAt, refreshIdentity]);

  if (operator === null || (expiresAt !== null && endedAt === expiresAt)) {
    return (
      <Navigate
        to="/cassa"
        replace
        state={{ turnEnded: startedWithCashier } satisfies CashierLocationState}
      />
    );
  }
  return (
    <SettingsProvider key={operator.id}>
      <CardReaderSession />
      <Outlet />
    </SettingsProvider>
  );
}

/** Whether a location state says the turn of the last cashier has ended. */
export function turnEndedIn(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'turnEnded' in state
    ? state.turnEnded === true
    : false;
}
