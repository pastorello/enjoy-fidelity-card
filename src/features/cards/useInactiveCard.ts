import { useCallback, useEffect, useState } from 'react';
import { useLatest } from '../../lib/useLatest';
import { useAuth } from '../identity/AuthProvider';
import { useCardsService } from './CardsServiceProvider';
import { CardsError, type CardDetail } from './types';

/** The card ids are the uuids of `app.cards`: anything else is no card, without asking. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InactiveCardState =
  | { status: 'loading' }
  | { status: 'done'; card: CardDetail }
  /** No card with that id, or an id that is not a uuid (then the service is not called). */
  | { status: 'not-found' }
  | { status: 'error'; error: unknown };

/** The state, and `retry` to load again at once (after an error). */
export type InactiveCardLoad = InactiveCardState & { retry: () => void };

/**
 * Loads the card of `/card/:cardId` (`app.get_card`, SPEC-customers-v2 point 4). An answer for a
 * card the page has since left is dropped; a `not_operator` refusal goes to `AuthProvider` (back
 * to /accedi).
 */
export function useInactiveCard(cardId: string): InactiveCardLoad {
  const service = useCardsService();
  const { reportNotEnabled } = useAuth();
  // The latest reporter, without loading again when its identity changes.
  const report = useLatest(reportNotEnabled);
  const valid = UUID.test(cardId);
  // Keyed by card and attempt, so a new card or "Riprova" shows the loading state at once.
  const [loaded, setLoaded] = useState<{ key: string; state: InactiveCardState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${cardId}#${attempt}`;

  useEffect(() => {
    if (!valid) return undefined;
    let current = true;
    service.getCard(cardId).then(
      (card) => {
        if (!current) return;
        setLoaded({
          key,
          state: card === null ? { status: 'not-found' } : { status: 'done', card },
        });
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
  }, [service, cardId, key, valid, report]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  let state: InactiveCardState;
  if (!valid) state = { status: 'not-found' };
  else state = loaded?.key === key ? loaded.state : { status: 'loading' };
  return { ...state, retry };
}
