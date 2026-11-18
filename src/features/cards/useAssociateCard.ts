import { useCallback, useEffect, useRef, useState } from 'react';
import type { CardRead } from '../card-input/cardReader';
import { useCardRead } from '../card-input/useCardRead';
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
  /** Associated (or reactivated): the link is written next (SPEC-cards, point 8); reads are off. */
  | { status: 'associated'; card: CardSummary }
  /** The card read is already this customer's active card: nothing changed. */
  | { status: 'already'; card: CardSummary }
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

/** The confirmation the customer page shows once, after the write of the link or without it. */
export function associatedNotice(uid: string, linkWritten: boolean): string {
  const associated = `Card ${formatCardLabel(uid)} associata`;
  return linkWritten ? associated : `${associated}. Link non scritto.`;
}

/**
 * The card reads of Associa card (`/clienti/:id/card`): each one is `associate`d to the customer.
 * A new card (or the customer's own deactivated one, reactivated) is `associated`, and the page
 * writes its link; the card already active (`activeCard`, as loaded) is `already` and nothing
 * changes; `card_taken` names the owner; no answer offers "Riprova" with the same uid, which changes
 * nothing twice. Reads are off while saving, once associated, while "Card già associata" is shown
 * and while `writing` (the page writes the link of the card already active). A `not_operator`
 * refusal goes to `AuthProvider`.
 */
export function useAssociateCard(
  customerId: string,
  activeCard: CardSummary | null,
  { writing = false }: { writing?: boolean } = {},
): AssociateCard {
  const service = useCardsService();
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
          setState({ status: knownActive.current === card.uid ? 'already' : 'associated', card });
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
    [service, customerId, reportNotEnabled],
  );

  const reading =
    !writing &&
    state.status !== 'associating' &&
    state.status !== 'associated' &&
    // The page writes the link of the card already active at once when it has none.
    !(state.status === 'already' && state.card.linkState === 'not-written') &&
    state.status !== 'taken' &&
    state.status !== 'unavailable';
  useCardRead((read: CardRead) => associate(read.uid), { enabled: reading });

  const retry = useCallback(() => {
    if (lastUid.current !== null) associate(lastUid.current);
  }, [associate]);
  const readAgain = useCallback(() => setState({ status: 'idle' }), []);

  return { ...state, retry, readAgain };
}
