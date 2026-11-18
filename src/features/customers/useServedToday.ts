import { useCallback, useEffect, useRef, useState } from 'react';
import { useCustomerService } from './CustomerServiceProvider';
import type { CustomerSummary } from './types';
import { useNotOperator } from './useNotOperator';

export type ServedTodayState =
  /** First load still on its way: the home shows nothing for it. */
  | { status: 'loading' }
  | { status: 'done'; customers: CustomerSummary[] }
  /** `retrying` while "Riprova" waits for its answer. */
  | { status: 'error'; error: unknown; retrying: boolean };

/** The state, and `retry` to load again at once (after an error). */
export type ServedToday = ServedTodayState & { retry: () => void };

/**
 * The customers served today (SERVITI OGGI), loaded when the home opens and again whenever the
 * page becomes visible. A newer load supersedes the answers still on their way. A failed reload
 * on return keeps the list already shown (it was right a moment ago, and the next return tries
 * again); only a load with nothing to show turns into the error. A `not_operator` refusal is
 * also reported to `AuthProvider` (back to /accedi).
 */
export function useServedToday(): ServedToday {
  const service = useCustomerService();
  // In a ref: a new identity of the reporter must not load again.
  const notOperator = useNotOperator();
  const reportNotOperator = useRef(notOperator);
  useEffect(() => {
    reportNotOperator.current = notOperator;
  }, [notOperator]);
  const [state, setState] = useState<ServedTodayState>({ status: 'loading' });
  const latest = useRef(0);

  const load = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    service.servedToday().then(
      (customers) => {
        if (latest.current !== request) return;
        setState({ status: 'done', customers });
      },
      (error: unknown) => {
        if (latest.current !== request) return;
        reportNotOperator.current(error);
        setState((shown) =>
          shown.status === 'done' ? shown : { status: 'error', error, retrying: false },
        );
      },
    );
  }, [service]);

  useEffect(() => {
    load();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      // Answers arriving after the home is gone are dropped.
      latest.current += 1;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [load]);

  const retry = useCallback(() => {
    setState((shown) => (shown.status === 'error' ? { ...shown, retrying: true } : shown));
    load();
  }, [load]);

  return { ...state, retry };
}
