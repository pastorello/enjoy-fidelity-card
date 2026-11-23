import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '../../lib/useLatest';
import { useCustomerService } from './CustomerServiceProvider';
import type { CustomerListCursor, CustomerListRow } from './types';
import { useNotOperator } from './useNotOperator';

/** Wait after the last key before searching. */
export const SEARCH_DELAY_MS = 250;
/** Shorter texts (after cleaning) list everyone, like the server. */
const QUERY_MIN_CHARS = 2;

/**
 * The text the list is asked with: cleaned like `private.clean_name` (trimmed, inner spaces
 * collapsed), or '' (the whole list) when shorter than 2 characters.
 */
export function listQuery(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  return Array.from(cleaned).length >= QUERY_MIN_CHARS ? cleaned : '';
}

/** The next page: none asked, on its way, or failed (the rows already shown stay). */
export type CustomerListMore =
  { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: unknown };

export type CustomerListState =
  /** The first page is on its way: nothing to show yet. */
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | {
      status: 'done';
      /** The text these rows answer ('' for the whole list). */
      query: string;
      customers: CustomerListRow[];
      /** The last page was full: there may be more. */
      hasMore: boolean;
      more: CustomerListMore;
    };

/**
 * The state; `retry` loads the first page again at once (after its error); `loadMore` asks the
 * next page (also after its error), and does nothing while a request is on its way or at the end.
 */
export type CustomerList = CustomerListState & { retry: () => void; loadMore: () => void };

/** What the requests share, outside the render. */
type Session = {
  /** Bumped by every first-page load and by the unmount: older answers are dropped. */
  generation: number;
  /** The text of the rows shown or on their way; null before the first request. */
  query: string | null;
  cursor: CustomerListCursor | null;
  /** Pages received for `query`. */
  pages: number;
  hasMore: boolean;
  /** A request is on its way (one at a time). */
  busy: boolean;
};

function cursorOf(row: CustomerListRow): CustomerListCursor {
  // Sent back as received: strings with microseconds, never `Date`.
  return { activityAt: row.lastActivityAt, createdAt: row.createdAt, id: row.id };
}

/** `rows` without the ids already in `shown` (a safeguard: on still data it never drops one). */
function appendNew(shown: CustomerListRow[], rows: CustomerListRow[]): CustomerListRow[] {
  const seen = new Set(shown.map((row) => row.id));
  const added: CustomerListRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    added.push(row);
  }
  return [...shown, ...added];
}

/**
 * The CLIENTI list of the home (SPEC-customers-v2 point 6): the first page when the home opens,
 * then one page at a time with the last row received as the cursor. A change of the text loads
 * its first page 250 ms after the last change; under 2 characters it is the whole list. Answers
 * superseded by a newer text are dropped. When the page becomes visible the first page loads again,
 * only if it is the only one loaded (whoever is scrolling keeps the place); a failed reload keeps
 * the rows shown. A `not_operator` refusal is also reported to `AuthProvider` (back to /accedi).
 */
export function useCustomerList(text: string): CustomerList {
  const service = useCustomerService();
  const reportNotOperator = useLatest(useNotOperator());
  const query = listQuery(text);
  const [state, setState] = useState<CustomerListState>({ status: 'loading' });
  const session = useRef<Session>({
    generation: 0,
    query: null,
    cursor: null,
    pages: 0,
    hasMore: false,
    busy: false,
  });

  /** Loads the first page of `target`; `quiet` (a reload) shows no loading and keeps rows on error. */
  const loadFirst = useCallback(
    (target: string, quiet: boolean) => {
      const current = session.current;
      current.generation += 1;
      const generation = current.generation;
      current.query = target;
      current.busy = true;
      if (!quiet) {
        current.pages = 0;
        current.cursor = null;
        setState({ status: 'loading' });
      }
      service.list({ query: target, after: null }).then(
        ({ customers, hasMore }) => {
          if (current.generation !== generation) return;
          current.busy = false;
          current.pages = 1;
          const last = customers.at(-1);
          current.cursor = last ? cursorOf(last) : null;
          current.hasMore = hasMore;
          setState({
            status: 'done',
            query: target,
            customers: appendNew([], customers),
            hasMore,
            more: { status: 'idle' },
          });
        },
        (error: unknown) => {
          if (current.generation !== generation) return;
          current.busy = false;
          reportNotOperator.current(error);
          if (quiet) return;
          setState({ status: 'error', error });
        },
      );
    },
    [service, reportNotOperator],
  );

  // A new text supersedes whatever is on its way at once, and is listed after the typing pause;
  // the first request of the home goes without waiting.
  useEffect(() => {
    const current = session.current;
    const first = current.query === null;
    if (!first) {
      current.generation += 1;
      current.busy = false;
    }
    const timer = setTimeout(() => loadFirst(query, false), first ? 0 : SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, loadFirst]);

  useEffect(() => {
    const current = session.current;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (current.pages !== 1 || current.busy || current.query === null) return;
      loadFirst(current.query, true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [loadFirst]);

  // Answers arriving after the home is gone are dropped.
  useEffect(() => {
    const current = session.current;
    return () => {
      current.generation += 1;
      current.busy = false;
    };
  }, []);

  const loadMore = useCallback(() => {
    const current = session.current;
    if (current.busy || current.pages === 0 || !current.hasMore || current.query === null) return;
    const generation = current.generation;
    const target = current.query;
    current.busy = true;
    setState((shown) =>
      shown.status === 'done' ? { ...shown, more: { status: 'loading' } } : shown,
    );
    service.list({ query: target, after: current.cursor }).then(
      ({ customers, hasMore }) => {
        if (current.generation !== generation) return;
        current.busy = false;
        current.pages += 1;
        const last = customers.at(-1);
        if (last) current.cursor = cursorOf(last);
        current.hasMore = hasMore;
        setState((shown) =>
          shown.status === 'done'
            ? {
                ...shown,
                customers: appendNew(shown.customers, customers),
                hasMore,
                more: { status: 'idle' },
              }
            : shown,
        );
      },
      (error: unknown) => {
        if (current.generation !== generation) return;
        current.busy = false;
        reportNotOperator.current(error);
        setState((shown) =>
          shown.status === 'done' ? { ...shown, more: { status: 'error', error } } : shown,
        );
      },
    );
  }, [service, reportNotOperator]);

  const retry = useCallback(() => {
    loadFirst(session.current.query ?? query, false);
  }, [loadFirst, query]);

  return { ...state, retry, loadMore };
}
