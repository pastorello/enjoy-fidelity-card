import { useEffect, useRef, useState } from 'react';
import { useCustomerService } from './CustomerServiceProvider';
import { classifyQuery } from './phone';
import type { CustomerSummary } from './types';

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

/**
 * Searches customers while the operator types: one call 250 ms after the last change, none for a
 * text too short to search, and an answer is dropped when a newer text has superseded it.
 */
export function useCustomerSearch(text: string): CustomerSearchState {
  const service = useCustomerService();
  const query = text.trim();
  const searchable = classifyQuery(query) !== 'none';
  const [state, setState] = useState<CustomerSearchState>({ status: 'idle' });
  const latest = useRef(0);

  // A text too short to search shows the default content at once (derived during render, so old
  // results never come back while the next search waits for its 250 ms).
  if (!searchable && state.status !== 'idle') setState({ status: 'idle' });

  useEffect(() => {
    // Any new text supersedes the answers still on their way.
    latest.current += 1;
    const request = latest.current;
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
          setState({ status: 'error', error });
        },
      );
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, searchable, service]);

  return state;
}
