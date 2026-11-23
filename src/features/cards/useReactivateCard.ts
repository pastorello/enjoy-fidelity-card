import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ServerFaultError } from '../../lib/serverFault';
import { loadErrorText } from '../customers/loadErrorText';
import { useAuth } from '../identity/AuthProvider';
import { useCardsService } from './CardsServiceProvider';
import { formatCardLabel } from './formatCard';
import {
  ActiveCardChangedError,
  CardForbiddenError,
  CardReleasedError,
  CardsError,
  CustomerUnavailableError,
  NetworkError,
  type CardDetail,
  type CardSummary,
} from './types';

/** Where «Riattiva la card» stands (SPEC-customers-v2, point 4, «Riattiva»). */
export type ReactivateState =
  /** Nothing asked yet, or the confirmation closed with «Lascia com'è». */
  | { status: 'idle' }
  /**
   * The confirmation is open. `busy` while the request (or the reload after
   * `active_card_changed`) is on its way; `error` after no answer, with «Riprova». `round` changes
   * when the confirmation is asked again after a reload, so it opens anew.
   */
  | { status: 'confirming'; busy: boolean; error: string | null; round: number }
  /** Reactivated: the link is written next. */
  | { status: 'reactivated'; card: CardSummary }
  /** The server refused for good (`forbidden`, `card_released`, `customer_anonymized`). */
  | { status: 'refused'; text: string };

export type ReactivateCard = ReactivateState & {
  /** «Riattiva la card»: opens the confirmation; nothing is sent yet. */
  ask: () => void;
  /** «Riattiva» / «Scambia le card» (and «Riprova»): sends the reactivation, once at a time. */
  confirm: () => void;
  /** «Lascia com'è»: closes the confirmation (not while the request is on its way). */
  cancel: () => void;
};

/** The confirmation the customer page shows once, after the write of the link or without it. */
export function reactivatedNotice(uid: string, linkWritten: boolean): string {
  const reactivated = `Card ${formatCardLabel(uid)} riattivata`;
  return linkWritten ? reactivated : `${reactivated}. Link non scritto.`;
}

/** No answer, or an unexpected one: the dialog stays open and «Riprova» is safe (idempotent). */
function retryText(error: unknown): string {
  if (error instanceof ServerFaultError) return `Card non riattivata. ${loadErrorText(error)}`;
  if (error instanceof NetworkError) return 'Card non riattivata: controlla la connessione.';
  return 'Card non riattivata: riprova.';
}

/** A refusal that sending again would not change, with its text; null otherwise. */
function refusalText(error: unknown): string | null {
  if (error instanceof CardForbiddenError) return error.text;
  if (error instanceof CardReleasedError) return 'Questa card è già stata riformattata.';
  if (error instanceof CustomerUnavailableError && error.reason === 'anonymized') {
    return 'Questo cliente non può avere una card.';
  }
  return null;
}

/**
 * «Riattiva la card» of `/card/:cardId` (SPEC-customers-v2, point 4): always a confirmation first,
 * then `reactivate_card` with the customer's active card the confirmation named (`null` for none).
 * `active_card_changed` loads the card again (`reload`, in the background) and asks again with the
 * right card; no answer keeps the dialog open with «Riprova» (sending it again changes nothing). A
 * `not_operator` refusal goes to `AuthProvider`. `card` is null while there is no deactivated card
 * to reactivate (loading, or found active or reformatted after a reload): nothing is sent.
 */
export function useReactivateCard(card: CardDetail | null, reload: () => void): ReactivateCard {
  const service = useCardsService();
  const { reportNotEnabled } = useAuth();
  const [state, setState] = useState<ReactivateState>({ status: 'idle' });
  // Set synchronously, so a double tap in the same frame sends one request.
  const sending = useRef(false);
  // Waiting for the card loaded again after `active_card_changed`.
  const reloading = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The card loaded again (a new object): ask again, with the card the server has now. Before
  // paint, so the old confirmation never shows the new card.
  useLayoutEffect(() => {
    if (!reloading.current) return;
    reloading.current = false;
    sending.current = false;
    setState((current) => {
      if (current.status !== 'confirming') return current;
      // Reactivated or reformatted meanwhile: the page says so, there is nothing to confirm.
      if (card === null) return { status: 'idle' };
      return { status: 'confirming', busy: false, error: null, round: current.round + 1 };
    });
  }, [card]);

  const ask = useCallback(() => {
    setState({ status: 'confirming', busy: false, error: null, round: 0 });
  }, []);

  const cancel = useCallback(() => {
    if (sending.current) return;
    setState({ status: 'idle' });
  }, []);

  const confirm = useCallback(() => {
    if (card === null || sending.current) return;
    sending.current = true;
    setState((current) =>
      current.status === 'confirming' ? { ...current, busy: true, error: null } : current,
    );
    service.reactivateCard(card.id, card.otherActiveCard?.id ?? null).then(
      (association) => {
        sending.current = false;
        if (!mounted.current) return;
        setState({ status: 'reactivated', card: association.card });
      },
      (error: unknown) => {
        if (!mounted.current) return;
        if (error instanceof ActiveCardChangedError) {
          // Stays busy until the card is loaded again.
          reloading.current = true;
          reload();
          return;
        }
        sending.current = false;
        if (error instanceof CardsError && error.kind === 'not_operator') {
          setState({ status: 'idle' });
          void reportNotEnabled();
          return;
        }
        const refusal = refusalText(error);
        if (refusal !== null) {
          setState({ status: 'refused', text: refusal });
          return;
        }
        setState((current) =>
          current.status === 'confirming'
            ? { ...current, busy: false, error: retryText(error) }
            : current,
        );
      },
    );
  }, [service, card, reload, reportNotEnabled]);

  return { ...state, ask, confirm, cancel };
}
