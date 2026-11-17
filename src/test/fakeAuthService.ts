import { vi } from 'vitest';
import type { AuthService, Operator, SignInResult } from '../features/identity/types';

export const fakeOperator: Operator = { id: 'op-1', name: 'Giulia Prova', role: 'admin' };

type FakeOptions = {
  /** Session already saved on the device. */
  userId?: string | null;
  operator?: Operator | null;
  signInResult?: SignInResult;
};

/**
 * In-memory AuthService for component tests. `endSession()` simulates an expired session,
 * `switchUser()` another tab or a link saving a different user's session.
 */
export function createFakeAuthService({
  userId = null,
  operator = fakeOperator,
  signInResult = 'ok',
}: FakeOptions = {}) {
  let currentUser = userId;
  let profile = operator;
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
  };
}
