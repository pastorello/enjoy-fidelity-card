import { useCallback, useRef, useState } from 'react';
import { useLatest } from '../../lib/useLatest';
import { LedgerError } from './types';

/** Where a ledger write stands (SPEC-ledger, points 3, 4 and 7). */
export type OperationState<T> =
  | { status: 'idle' }
  /** Sent: further submits and retries are ignored until the answer. */
  | { status: 'busy' }
  | { status: 'done'; result: T }
  /**
   * `retryable`: the outcome is uncertain (no answer, `unknown`, a server fault, anything
   * unexpected), the id is kept and "Riprova" sends it again. Otherwise the server refused for
   * good and the id is gone.
   */
  | { status: 'error'; error: unknown; retryable: boolean };

export type Operation<T> = OperationState<T> & {
  /** "Conferma": a new operation id, or the one kept from an uncertain outcome. */
  submit: () => Promise<void>;
  /** "Riprova": the same operation id again; only after a retryable error. */
  retry: () => void;
  /** "Annulla" / "Correggi": the id is discarded and a late answer is dropped. */
  reset: () => void;
};

/** A refusal the server gave for good: resending the same id would answer it again. */
export function isDefinitive(error: unknown): boolean {
  return error instanceof LedgerError && error.kind !== 'network' && error.kind !== 'unknown';
}

/**
 * A ledger write with an app-generated `operation_id` (SPEC-ledger, "Code Style"): the id is
 * born on the first submit and kept while the outcome is uncertain, so "Riprova" resends it and
 * the server answers the first result instead of recording twice. A success or a definitive
 * refusal consumes it. Calls while busy are ignored (a double tap is one call), nothing is resent
 * on its own and the id lives in memory only (Open Question 8).
 */
export function useOperation<T>(run: (operationId: string) => Promise<T>): Operation<T> {
  const [state, setState] = useState<OperationState<T>>({ status: 'idle' });
  // The run of the screen on show (its amount), even for a tap before `useEffect` runs.
  const latestRun = useLatest(run);
  // Refs, set synchronously, so two taps in the same tick start a single call.
  const busy = useRef(false);
  const pendingId = useRef<string | null>(null);
  // Bumped by reset: an answer of an older attempt is dropped.
  const attempt = useRef(0);

  const send = useCallback(
    async (operationId: string) => {
      busy.current = true;
      const mine = ++attempt.current;
      setState({ status: 'busy' });
      try {
        const result = await latestRun.current(operationId);
        if (mine !== attempt.current) return;
        pendingId.current = null;
        setState({ status: 'done', result });
      } catch (error) {
        if (mine !== attempt.current) return;
        const retryable = !isDefinitive(error);
        if (!retryable) pendingId.current = null;
        setState({ status: 'error', error, retryable });
      } finally {
        if (mine === attempt.current) busy.current = false;
      }
    },
    [latestRun],
  );

  const submit = useCallback(async () => {
    if (busy.current) return;
    pendingId.current ??= crypto.randomUUID();
    await send(pendingId.current);
  }, [send]);

  const retry = useCallback(() => {
    if (busy.current || pendingId.current === null) return;
    void send(pendingId.current);
  }, [send]);

  const reset = useCallback(() => {
    attempt.current++;
    busy.current = false;
    pendingId.current = null;
    setState({ status: 'idle' });
  }, []);

  return { ...state, submit, retry, reset };
}
