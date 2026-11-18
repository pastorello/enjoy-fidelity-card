import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CardRead } from '../card-input/cardReader';
import { useCardRead } from '../card-input/useCardRead';
import { homeNoticeState } from '../customers/homeNotice';
import { useAuth } from '../identity/AuthProvider';
import { useCardsService } from './CardsServiceProvider';
import { formatCardLabel } from './formatCard';
import {
  CardTakenError,
  CardsError,
  CustomerUnavailableError,
  type CardOwner,
  type CardSummary,
} from './types';

/** Where Associa card stands after the last card read (SPEC-cards, point 4). */
export type AssociateCardState =
  | { status: 'idle' }
  /** «Associazione in corso…»: other reads are dropped until it ends. */
  | { status: 'associating' }
  /** "Card già associata": reads are dropped until «Riprova con un'altra card». */
  | { status: 'taken'; owner: CardOwner | null }
  /** The card read is already this customer's active card: nothing changed. */
  | { status: 'already' }
  /** No answer (or an unexpected one): `retry` sends the same uid again (idempotent). */
  | { status: 'error'; error: unknown }
  /** The customer cannot get a card any more: erased, or gone. */
  | { status: 'unavailable'; reason: 'not-found' | 'anonymized' };

export type AssociateCard = AssociateCardState & {
  /** "Riprova" after an error: the same uid again. */
  retry: () => void;
  /** «Riprova con un'altra card»: back to reading. */
  readAgain: () => void;
};

/** The confirmation the customer page shows once (the link is written from task 17 on). */
export function associatedNotice(uid: string): string {
  return `Card ${formatCardLabel(uid)} associata. Link non scritto.`;
}

/**
 * The card reads of Associa card (`/clienti/:id/card`): each one is `associate`d to the customer.
 * A new card (or the customer's own deactivated one, reactivated) opens the customer page in place
 * of this one with the confirmation; the card already active (`activeCard`, as loaded) is said and
 * nothing changes; `card_taken` names the owner; no answer offers "Riprova" with the same uid, which
 * changes nothing twice. Reads are off while saving and while "Card già associata" is shown. A
 * `not_operator` refusal goes to `AuthProvider`.
 */
export function useAssociateCard(
  customerId: string,
  activeCard: CardSummary | null,
): AssociateCard {
  const service = useCardsService();
  const navigate = useNavigate();
  const { reportNotEnabled } = useAuth();
  const [state, setState] = useState<AssociateCardState>({ status: 'idle' });
  // Set synchronously, so two reads in the same tick start a single association.
  const busy = useRef(false);
  const lastUid = useRef<string | null>(null);
  // The active card as the page loaded it: tells "already active" from a replacement.
  const knownActive = useRef(activeCard?.uid ?? null);
  useEffect(() => {
    knownActive.current = activeCard?.uid ?? null;
  }, [activeCard]);
  // An answer that arrives after the page is gone is dropped.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const associate = useCallback(
    (uid: string) => {
      if (busy.current) return;
      busy.current = true;
      lastUid.current = uid;
      setState({ status: 'associating' });
      service.associate(customerId, uid).then(
        ({ card }) => {
          busy.current = false;
          if (!mounted.current) return;
          if (knownActive.current === card.uid) {
            setState({ status: 'already' });
            return;
          }
          void navigate(`/clienti/${customerId}`, {
            replace: true,
            state: homeNoticeState(associatedNotice(card.uid)),
          });
        },
        (error: unknown) => {
          busy.current = false;
          if (!mounted.current) return;
          if (error instanceof CardTakenError) {
            setState({ status: 'taken', owner: error.owner });
          } else if (error instanceof CustomerUnavailableError) {
            setState({ status: 'unavailable', reason: error.reason });
          } else if (error instanceof CardsError && error.kind === 'not_operator') {
            setState({ status: 'idle' });
            void reportNotEnabled();
          } else {
            setState({ status: 'error', error });
          }
        },
      );
    },
    [service, customerId, navigate, reportNotEnabled],
  );

  const reading =
    state.status !== 'associating' && state.status !== 'taken' && state.status !== 'unavailable';
  useCardRead((read: CardRead) => associate(read.uid), { enabled: reading });

  const retry = useCallback(() => {
    if (lastUid.current !== null) associate(lastUid.current);
  }, [associate]);
  const readAgain = useCallback(() => setState({ status: 'idle' }), []);

  return { ...state, retry, readAgain };
}
