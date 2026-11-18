import { useCallback, useEffect, useRef, useState } from 'react';
import { useCustomerService } from './CustomerServiceProvider';
import { classifyQuery } from './phone';
import type { CustomerSummary } from './types';
import { useNotOperator } from './useNotOperator';

/** Wait after the last key before searching. */
export const SEARCH_DELAY_MS = 250;
/** Rows shown; the server sends one more to say there are others. */
export const SEARCH_SHOWN_ROWS = 20;

export type CustomerSearchState =
  /** The text is too short: no search, the home shows its default content. */
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; customers: CustomerSummary[]; hasMore: boolean }
  | { status: 'error'; error: unknown };

/** The state, and `retry` to search the same text again at once (after an error). */
export type CustomerSearch = CustomerSearchState & { retry: () => void };

/**
 * Searches customers while the operator types: one call 250 ms after the last change, none for a
 * text too short to search, and an answer is dropped when a newer text has superseded it. A
 * `not_operator` refusal is also reported to `AuthProvider` (back to /accedi).
 */
export function useCustomerSearch(text: string): CustomerSearch {
  const service = useCustomerService();
  // In a ref: a new identity of the reporter must not search again.
  const notOperator = useNotOperator();
  const reportNotOperator = useRef(notOperator);
  useEffect(() => {
    reportNotOperator.current = notOperator;
  }, [notOperator]);
  const query = text.trim();
  const searchable = classifyQuery(query) !== 'none';
  const [state, setState] = useState<CustomerSearchState>({ status: 'idle' });
  const latest = useRef(0);
  // Each "Riprova" bumps it: the search runs again, without the typing delay.
  const [attempt, setAttempt] = useState(0);
  const searchedAttempt = useRef(0);

  // A text too short to search shows the default content at once (derived during render, so old
  // results never come back while the next search waits for its 250 ms).
  if (!searchable && state.status !== 'idle') setState({ status: 'idle' });

  useEffect(() => {
    // Any new text supersedes the answers still on their way.
    latest.current += 1;
    const request = latest.current;
    const delay = attempt > searchedAttempt.current ? 0 : SEARCH_DELAY_MS;
    searchedAttempt.current = attempt;
    if (!searchable) return undefined;
    const timer = setTimeout(() => {
      setState({ status: 'loading' });
      service.search(query).then(
        (rows) => {
          if (latest.current !== request) return;
          setState({
            status: 'done',
            customers: rows.slice(0, SEARCH_SHOWN_ROWS),
            hasMore: rows.length > SEARCH_SHOWN_ROWS,
          });
        },
        (error: unknown) => {
          if (latest.current !== request) return;
          reportNotOperator.current(error);
          setState({ status: 'error', error });
        },
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [query, searchable, service, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { ...state, retry };
}
