import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthService, Operator, SignedOutReason, SignInResult } from './types';

export type AuthState =
  | { status: 'loading' }
  /** The profile could not be loaded (network): the app offers "Riprova". */
  | { status: 'error' }
  | { status: 'signed-out'; reason?: SignedOutReason }
  | { status: 'signed-in'; operator: Operator };

export type SignInOutcome = SignInResult | 'not-enabled';

type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Holds who is signed in on this device. Only this feature talks to Supabase Auth. */
export function AuthProvider({ service, children }: { service: AuthService; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // Supabase reports every sign-out, ours included: only the others mean "expired".
  const signingOut = useRef(false);

  const endSession = useCallback(async () => {
    signingOut.current = true;
    try {
      await service.signOut();
    } finally {
      signingOut.current = false;
    }
  }, [service]);

  const restore = useCallback(async (): Promise<AuthState> => {
    const userId = await service.currentUserId();
    if (!userId) return { status: 'signed-out' };
    const operator = await service.loadOperator(userId);
    if (operator) return { status: 'signed-in', operator };
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
    const unsubscribe = service.onSignedOut(() => {
      if (signingOut.current) return;
      setState((current) =>
        current.status === 'signed-in' ? { status: 'signed-out', reason: 'expired' } : current,
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [service, restore]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInOutcome> => {
      const result = await service.signIn(email, password);
      if (result !== 'ok') return result;
      const userId = await service.currentUserId();
      const operator = userId ? await service.loadOperator(userId) : null;
      if (!operator) {
        await endSession();
        setState({ status: 'signed-out' });
        return 'not-enabled';
      }
      setState({ status: 'signed-in', operator });
      return 'ok';
    },
    [service, endSession],
  );

  const signOut = useCallback(async () => {
    await endSession();
    setState({ status: 'signed-out' });
  }, [endSession]);

  const value = useMemo(() => ({ state, signIn, signOut, retry }), [state, signIn, signOut, retry]);
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
