import { useCallback } from 'react';
import { useAuth } from '../identity/AuthProvider';
import { CustomerError } from './types';

/**
 * For the rejections of every `CustomerService` call: a `not_operator` refusal (the account was
 * removed or disabled while in use) goes to `AuthProvider`, which checks the profile again and
 * sends the app back to /accedi with "Account non abilitato" when it is gone. Returns whether the
 * error was that refusal.
 */
export function useNotOperator(): (error: unknown) => boolean {
  const { reportNotEnabled } = useAuth();
  return useCallback(
    (error: unknown) => {
      if (!(error instanceof CustomerError) || error.kind !== 'not_operator') return false;
      void reportNotEnabled();
      return true;
    },
    [reportNotEnabled],
  );
}
