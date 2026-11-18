import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../identity/AuthProvider';
import { useLedgerService } from './LedgerServiceProvider';
import { LedgerError } from './types';
import type { Movement } from './types';

export type MovementsState =
  | { status: 'loading' }
  | { status: 'done'; movements: Movement[] }
  /** `retrying` while "Riprova" waits for its answer. */
  | { status: 'error'; error: unknown; retrying: boolean };

/** The state, and `retry` to load again (after an error). */
export type Movements = MovementsState & { retry: () => void };

/**
 * The newest `limit` movements of a customer, newest first (`listMovements`; SPEC-ledger point 8).
 * A newer load supersedes the answers still on their way; answers after unmount are dropped. A
 * `forbidden` refusal is reported to `AuthProvider` (`reportNotEnabled`).
 */
export function useMovements(customerId: string, limit: number): Movements {
  const service = useLedgerService();
  const { reportNotEnabled } = useAuth();
  // In a ref: a new identity of the reporter must not load again.
  const report = useRef(reportNotEnabled);
  useEffect(() => {
    report.current = reportNotEnabled;
  }, [reportNotEnabled]);
  const [state, setState] = useState<MovementsState>({ status: 'loading' });
  const latest = useRef(0);

  const load = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    service.listMovements(customerId, { limit }).then(
      (movements) => {
        if (latest.current !== request) return;
        setState({ status: 'done', movements });
      },
      (error: unknown) => {
        if (latest.current !== request) return;
        if (error instanceof LedgerError && error.kind === 'forbidden') void report.current();
        setState({ status: 'error', error, retrying: false });
      },
    );
  }, [service, customerId, limit]);

  useEffect(() => {
    load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  const retry = useCallback(() => {
    setState((shown) => (shown.status === 'error' ? { ...shown, retrying: true } : shown));
    load();
  }, [load]);

  return { ...state, retry };
}
