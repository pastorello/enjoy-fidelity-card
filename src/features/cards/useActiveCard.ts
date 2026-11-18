import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../identity/AuthProvider';
import { useCardsService } from './CardsServiceProvider';
import { CardsError, type CardSummary } from './types';

export type ActiveCardState =
  | { status: 'loading' }
  | { status: 'done'; card: CardSummary | null }
  | { status: 'error'; error: unknown };

/** The state, and `retry` to load again at once (after an error). */
export type ActiveCardLoad = ActiveCardState & { retry: () => void };

/**
 * Loads the customer's active card (or null). An answer for a customer the page has since left is
 * dropped. A `not_operator` refusal goes to `AuthProvider` (back to /accedi).
 */
export function useActiveCard(customerId: string, { enabled = true } = {}): ActiveCardLoad {
  const service = useCardsService();
  const { reportNotEnabled } = useAuth();
  // In a ref: a new identity of the reporter must not load again.
  const report = useRef(reportNotEnabled);
  useEffect(() => {
    report.current = reportNotEnabled;
  }, [reportNotEnabled]);
  // Keyed by customer and attempt, so a new customer or "Riprova" shows the loading state at once.
  const [loaded, setLoaded] = useState<{ key: string; state: ActiveCardState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${customerId}#${attempt}`;

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    service.getActiveCard(customerId).then(
      (card) => {
        if (current) setLoaded({ key, state: { status: 'done', card } });
      },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof CardsError && error.kind === 'not_operator') {
          void report.current();
        }
        setLoaded({ key, state: { status: 'error', error } });
      },
    );
    return () => {
      current = false;
    };
  }, [service, customerId, key, enabled]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const state: ActiveCardState = loaded?.key === key ? loaded.state : { status: 'loading' };
  return { ...state, retry };
}
