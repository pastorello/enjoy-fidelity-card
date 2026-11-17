import { vi } from 'vitest';
import type { AuthService, Operator, SignInResult } from '../features/identity/types';

export const fakeOperator: Operator = { id: 'op-1', name: 'Giulia Prova', role: 'admin' };

type FakeOptions = {
  /** Session already saved on the device. */
  userId?: string | null;
  operator?: Operator | null;
  signInResult?: SignInResult;
};

/** In-memory AuthService for component tests. `endSession()` simulates an expired session. */
export function createFakeAuthService({
  userId = null,
  operator = fakeOperator,
  signInResult = 'ok',
}: FakeOptions = {}) {
  let currentUser = userId;
  const listeners = new Set<() => void>();

  const service = {
    currentUserId: vi.fn<AuthService['currentUserId']>(() => Promise.resolve(currentUser)),
    signIn: vi.fn<AuthService['signIn']>(() => {
      if (signInResult === 'ok') currentUser = 'user-1';
      return Promise.resolve(signInResult);
    }),
    signOut: vi.fn<AuthService['signOut']>(() => {
      currentUser = null;
      return Promise.resolve();
    }),
    loadOperator: vi.fn<AuthService['loadOperator']>(() => Promise.resolve(operator)),
    onSignedOut: vi.fn<AuthService['onSignedOut']>((listener) => {
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
      for (const listener of listeners) listener();
    },
  };
}
