import { vi } from 'vitest';
import type {
  AuthService,
  Operator,
  ResetRequestResult,
  SignInResult,
  UpdatePasswordResult,
  VerifyRecoveryResult,
} from '../features/identity/types';

export const fakeOperator: Operator = { id: 'op-1', name: 'Giulia Prova', role: 'admin' };

type FakeOptions = {
  /** Session already saved on the device. */
  userId?: string | null;
  operator?: Operator | null;
  signInResult?: SignInResult;
  /** Email of the saved session, returned by `currentEmail()` while signed in. */
  email?: string;
  /** Results returned in order by each call; the last one repeats. Default: always success. */
  resetResults?: ResetRequestResult[];
  verifyResults?: VerifyRecoveryResult[];
  updatePasswordResults?: UpdatePasswordResult[];
  /** The account of the recovery link: a successful `verifyRecovery` switches the session to it. */
  recoveryUser?: { userId: string; operator: Operator | null; email: string };
};

/** Returns the programmed results one per call, repeating the last. */
function sequence<T>(results: readonly T[], fallback: T): () => T {
  let next = 0;
  return () => {
    const result = results[Math.min(next, results.length - 1)] ?? fallback;
    next += 1;
    return result;
  };
}

/**
 * In-memory AuthService for component tests. `endSession()` simulates an expired session,
 * `switchUser()` another tab or a link saving a different user's session, `removeProfile()`
 * an administrator removing the account while the app is open, `setProfile()` an administrator
 * changing it (such as the role). Every method is a `vi.fn`, so
 * tests count calls (double taps, retries without a second verification) with `toHaveBeenCalledTimes`.
 */
export function createFakeAuthService({
  userId = null,
  operator = fakeOperator,
  signInResult = 'ok',
  email = 'giulia@example.com',
  resetResults = [],
  verifyResults = [],
  updatePasswordResults = [],
  recoveryUser = { userId: 'user-1', operator, email },
}: FakeOptions = {}) {
  let currentUser = userId;
  let profile = operator;
  let currentAddress = email;
  const nextReset = sequence<ResetRequestResult>(resetResults, 'sent');
  const nextVerify = sequence<VerifyRecoveryResult>(verifyResults, 'ok');
  const nextUpdate = sequence<UpdatePasswordResult>(updatePasswordResults, 'ok');
  const listeners = new Set<(userId: string | null) => void>();
  const notify = (id: string | null) => {
    for (const listener of listeners) listener(id);
  };

  const service = {
    currentUserId: vi.fn<AuthService['currentUserId']>(() => Promise.resolve(currentUser)),
    signIn: vi.fn<AuthService['signIn']>(() => {
      if (signInResult === 'ok') {
        currentUser = 'user-1';
        notify(currentUser);
      }
      return Promise.resolve(signInResult);
    }),
    signOut: vi.fn<AuthService['signOut']>(() => {
      currentUser = null;
      return Promise.resolve();
    }),
    loadOperator: vi.fn<AuthService['loadOperator']>(() => Promise.resolve(profile)),
    onAuthChange: vi.fn<AuthService['onAuthChange']>((listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    currentEmail: vi.fn<AuthService['currentEmail']>(() =>
      Promise.resolve(currentUser === null ? null : currentAddress),
    ),
    requestPasswordReset: vi.fn<AuthService['requestPasswordReset']>(() =>
      Promise.resolve(nextReset()),
    ),
    verifyRecovery: vi.fn<AuthService['verifyRecovery']>(() => {
      const result = nextVerify();
      if (result === 'ok') {
        // Like verifyOtp: the link session replaces the saved one, without SIGNED_OUT.
        currentUser = recoveryUser.userId;
        profile = recoveryUser.operator;
        currentAddress = recoveryUser.email;
        notify(currentUser);
      }
      return Promise.resolve(result);
    }),
    updatePassword: vi.fn<AuthService['updatePassword']>(() => Promise.resolve(nextUpdate())),
    signOutOtherDevices: vi.fn<AuthService['signOutOtherDevices']>(() => Promise.resolve()),
  } satisfies AuthService;

  return {
    service,
    endSession() {
      currentUser = null;
      notify(null);
    },
    switchUser(nextUserId: string, nextOperator: Operator | null) {
      currentUser = nextUserId;
      profile = nextOperator;
      notify(nextUserId);
    },
    removeProfile() {
      profile = null;
    },
    setProfile(nextOperator: Operator | null) {
      profile = nextOperator;
    },
  };
}
