import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../identity/AuthProvider';
import { useLedgerService } from './LedgerServiceProvider';
import { LedgerError } from './types';
import type { Movement } from './types';

/** Movimenti loads the history 50 movements at a time (SPEC-ledger, Open Question 9). */
export const HISTORY_PAGE = 50;

export type MovementHistoryState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | {
      status: 'done';
      movements: Movement[];
      /** The last page was full: there may be older movements. */
      hasMore: boolean;
      /** "Mostra altri" is waiting for its answer. */
      loadingMore: boolean;
      /** The last "Mostra altri" failed; the rows shown stay. */
      moreFailed: boolean;
    };

export type MovementHistory = MovementHistoryState & {
  /** Load the first page again (after an error), showing the loading state meanwhile. */
  retry: () => void;
  /** Load the next page, older than the last movement shown. */
  loadMore: () => void;
};

/**
 * The history of a customer, newest first, 50 at a time (`listMovements` with a cursor; SPEC-ledger
 * point 9). A newer load supersedes the answers still on their way; answers after unmount are
 * dropped. A `forbidden` refusal is reported to `AuthProvider` (`reportNotEnabled`).
 */
export function useMovementHistory(customerId: string): MovementHistory {
  const service = useLedgerService();
  const { reportNotEnabled } = useAuth();
  // In a ref: a new identity of the reporter must not load again.
  const report = useRef(reportNotEnabled);
  useEffect(() => {
    report.current = reportNotEnabled;
  }, [reportNotEnabled]);
  const [state, setState] = useState<MovementHistoryState>({ status: 'loading' });
  const latest = useRef(0);

  const reportForbidden = useCallback((error: unknown) => {
    if (error instanceof LedgerError && error.kind === 'forbidden') void report.current();
  }, []);

  const load = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    service.listMovements(customerId, { limit: HISTORY_PAGE }).then(
      (movements) => {
        if (latest.current !== request) return;
        setState({
          status: 'done',
          movements,
          hasMore: movements.length === HISTORY_PAGE,
          loadingMore: false,
          moreFailed: false,
        });
      },
      (error: unknown) => {
        if (latest.current !== request) return;
        reportForbidden(error);
        setState({ status: 'error', error });
      },
    );
  }, [service, customerId, reportForbidden]);

  useEffect(() => {
    load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    load();
  }, [load]);

  const loadMore = useCallback(() => {
    if (state.status !== 'done' || !state.hasMore || state.loadingMore) return;
    const last = state.movements.at(-1);
    if (!last) return;
    const shown = state.movements;
    latest.current += 1;
    const request = latest.current;
    setState({ ...state, loadingMore: true, moreFailed: false });
    service
      .listMovements(customerId, {
        limit: HISTORY_PAGE,
        before: { createdAt: last.createdAt, id: last.id },
      })
      .then(
        (older) => {
          if (latest.current !== request) return;
          setState({
            status: 'done',
            movements: [...shown, ...older],
            hasMore: older.length === HISTORY_PAGE,
            loadingMore: false,
            moreFailed: false,
          });
        },
        (error: unknown) => {
          if (latest.current !== request) return;
          reportForbidden(error);
          setState({
            status: 'done',
            movements: shown,
            hasMore: true,
            loadingMore: false,
            moreFailed: true,
          });
        },
      );
  }, [state, service, customerId, reportForbidden]);

  return { ...state, retry, loadMore };
}
