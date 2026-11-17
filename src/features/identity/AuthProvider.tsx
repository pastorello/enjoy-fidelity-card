import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AuthService,
  Operator,
  ResetRequestResult,
  SignedOutReason,
  SignInResult,
} from './types';

export type AuthState =
  | { status: 'loading' }
  /** The profile could not be loaded (network): the app offers "Riprova". */
  | { status: 'error' }
  | { status: 'signed-out'; reason?: SignedOutReason }
  | { status: 'signed-in'; operator: Operator };

export type SignInOutcome = SignInResult | 'not-enabled';

/**
 * Result of "Salva e accedi" on the recovery page. Verification and save failures are kept
 * apart because the page words them differently. 'ok' means the password is saved: the state is
 * then signed in, or 'error' ("Riprova") when the profile could not be loaded.
 */
export type RecoveryOutcome =
  | 'ok'
  | 'not-enabled'
  | 'invalid-link'
  | 'verify-network'
  | 'verify-unknown'
  | 'same-password'
  | 'weak'
  | 'save-network'
  | 'save-unknown';

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
  /** The email of the saved session (prefills "Password dimenticata"), or null. */
  currentEmail: () => Promise<string | null>;
  /** Asks for the recovery email; every server answer is 'sent', only no answer is 'network'. */
  requestPasswordReset: (email: string, redirectTo: string) => Promise<ResetRequestResult>;
  /** Verifies the link (once per link), saves the password and signs in as the link's user. */
  completeRecovery: (tokenHash: string, password: string) => Promise<RecoveryOutcome>;
  /** Leaving the recovery page: a verified link whose password was not saved signs out. */
  abandonRecovery: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Holds who is signed in on this device. Only this feature talks to Supabase Auth. */
export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // Supabase reports every sign-out, ours included: only the others mean "expired".
  const signingOut = useRef(false);
  // The user whose profile was checked for the signed-in state; null when not signed in.
  const checkedUser = useRef<string | null>(null);
  // While the link is being verified its session replaces the saved one: not an outside change.
  const verifying = useRef(false);
  // The link whose session is active but whose password is not saved yet.
  const verifiedToken = useRef<string | null>(null);
  // The last save failed offline: it may have reached the server anyway.
  const saveMayHaveLanded = useRef(false);

  const endSession = useCallback(async () => {
    signingOut.current = true;
    try {
      await service.signOut();
    } finally {
      signingOut.current = false;
    }
  }, [service]);

  const restore = useCallback(async (): Promise<AuthState> => {
    checkedUser.current = null;
    const userId = await service.currentUserId();
    if (!userId) return { status: 'signed-out' };
    const operator = await service.loadOperator(userId);
    if (operator) {
      checkedUser.current = userId;
      return { status: 'signed-in', operator };
    }
    await endSession();
    return { status: 'signed-out', reason: 'not-enabled' };
  }, [service, endSession]);

  const retry = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState(await restore());
    } catch {
      setState({ status: 'error' });
    }
  }, [restore]);

  useEffect(() => {
    let active = true;
    restore().then(
      (next) => active && setState(next),
      () => active && setState({ status: 'error' }),
    );
    const unsubscribe = service.onAuthChange((userId) => {
      // Only a signed-in state can go stale; restore and signIn check their own session.
      if (signingOut.current || verifying.current || checkedUser.current === null) return;
      if (userId === checkedUser.current) return;
      checkedUser.current = null;
      if (userId === null) {
        setState({ status: 'signed-out', reason: 'expired' });
      } else {
        // Another user's session was saved (other tab, link): check its profile again.
        void retry();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [service, restore, retry]);

  // An administrator can remove the account while the app is open: its token keeps working
  // until it expires, but the profile is gone. Re-check it (one small query) whenever the app
  // comes back to the foreground.
  useEffect(() => {
    let checking = false;
    const recheck = async () => {
      const userId = checkedUser.current;
      if (checking || userId === null || signingOut.current) return;
      checking = true;
      let operator: Operator | null;
      try {
        operator = await service.loadOperator(userId);
      } catch {
        return; // Offline: keep the session, the next foreground event checks again.
      } finally {
        checking = false;
      }
      // Signed out, or switched to another user, while the check was running.
      if (checkedUser.current !== userId) return;
      if (operator) return;
      checkedUser.current = null;
      await endSession();
      setState({ status: 'signed-out', reason: 'not-enabled' });
    };
    const onFocus = () => void recheck();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void recheck();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [service, endSession]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInOutcome> => {
      const result = await service.signIn(email, password);
      if (result !== 'ok') return result;
      let userId: string | null;
      let operator: Operator | null;
      try {
        userId = await service.currentUserId();
        operator = userId ? await service.loadOperator(userId) : null;
      } catch {
        // The session is saved but its profile was never checked: do not keep it.
        await endSession();
        setState({ status: 'signed-out' });
        return 'network';
      }
      if (!userId || !operator) {
        await endSession();
        setState({ status: 'signed-out' });
        return 'not-enabled';
      }
      checkedUser.current = userId;
      setState({ status: 'signed-in', operator });
      return 'ok';
    },
    [service, endSession],
  );

  const signOut = useCallback(async () => {
    checkedUser.current = null;
    verifiedToken.current = null;
    saveMayHaveLanded.current = false;
    await endSession();
    setState({ status: 'signed-out' });
  }, [endSession]);

  const currentEmail = useCallback(() => service.currentEmail(), [service]);
  const requestPasswordReset = useCallback(
    (email: string, redirectTo: string) => service.requestPasswordReset(email, redirectTo),
    [service],
  );

  const completeRecovery = useCallback(
    async (tokenHash: string, password: string): Promise<RecoveryOutcome> => {
      if (verifiedToken.current !== tokenHash) {
        verifiedToken.current = null;
        saveMayHaveLanded.current = false;
        verifying.current = true;
        let verified;
        try {
          verified = await service.verifyRecovery(tokenHash);
        } finally {
          verifying.current = false;
        }
        if (verified === 'invalid-link') return 'invalid-link';
        if (verified === 'network') return 'verify-network';
        if (verified === 'unknown') return 'verify-unknown';
        // The link's session replaced any saved one: nobody is signed in until the save.
        verifiedToken.current = tokenHash;
        checkedUser.current = null;
        setState({ status: 'signed-out' });
      }

      const saved = await service.updatePassword(password);
      // After a lost answer, 'same-password' means the first request did save this password.
      const landed = saved === 'ok' || (saved === 'same-password' && saveMayHaveLanded.current);
      if (!landed) {
        saveMayHaveLanded.current = saved === 'network';
        if (saved === 'network') return 'save-network';
        if (saved === 'unknown') return 'save-unknown';
        return saved;
      }
      verifiedToken.current = null;
      saveMayHaveLanded.current = false;
      await service.signOutOtherDevices();

      let userId: string | null;
      let operator: Operator | null;
      try {
        userId = await service.currentUserId();
        operator = userId ? await service.loadOperator(userId) : null;
      } catch {
        // The password is saved and the session kept: "Riprova" loads the profile, as on restore.
        setState({ status: 'error' });
        return 'ok';
      }
      if (!userId || !operator) {
        await endSession();
        setState({ status: 'signed-out', reason: 'not-enabled' });
        return 'not-enabled';
      }
      checkedUser.current = userId;
      setState({ status: 'signed-in', operator });
      return 'ok';
    },
    [service, endSession],
  );

  const abandonRecovery = useCallback(async () => {
    if (verifiedToken.current === null) return;
    // The link alone never counts as a sign-in.
    verifiedToken.current = null;
    saveMayHaveLanded.current = false;
    checkedUser.current = null;
    await endSession();
    setState({ status: 'signed-out' });
  }, [endSession]);

  const value = useMemo(
    () => ({
      state,
      signIn,
      signOut,
      retry,
      currentEmail,
      requestPasswordReset,
      completeRecovery,
      abandonRecovery,
    }),
    [
      state,
      signIn,
      signOut,
      retry,
      currentEmail,
      requestPasswordReset,
      completeRecovery,
      abandonRecovery,
    ],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** The signed-in operator. Only for screens behind <RequireAuth>. */
export function useCurrentOperator(): Operator {
  const { state } = useAuth();
  if (state.status !== 'signed-in') throw new Error('useCurrentOperator needs a signed-in user');
  return state.operator;
}
