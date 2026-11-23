import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CardRead } from '../card-input/cardReader';
import { useCardRead } from '../card-input/useCardRead';
import { useAuth } from '../identity/AuthProvider';
import { useCardsService } from './CardsServiceProvider';
import { newCustomerCardState } from './newCustomerCardState';
import { CardsError } from './types';

/** What the home shows about the last card read (SPEC-cards, point 1). */
export type HomeCardState =
  | { status: 'idle' }
  /** `lookup` in progress: other reads are dropped until it ends. */
  | { status: 'reading' }
  /** A deactivated card (lost, then found): its customer, to open the customer page. */
  | { status: 'inactive'; customerId: string; customerName: string }
  /** The card of a customer whose data was erased: no name, nowhere to go. */
  | { status: 'anonymized' }
  /** The lookup failed: `retry` repeats it with the same uid (a read, never a duplicate). */
  | { status: 'error'; error: unknown };

export type HomeCardRead = HomeCardState & { retry: () => void };

/**
 * The card reads of the home "Cerca cliente": an active card opens Registra spesa of its customer
 * (`/clienti/:id/spesa`), an unknown one Nuovo cliente with the card (`/clienti/nuovo`,
 * the uid in the history state);
 * a deactivated card or one of an erased customer becomes a notice and reading stays on. The
 * consumer is off while a lookup runs, so a card held meanwhile is neither looked up nor vibrated.
 * Nothing here issues or writes a link (criterion 14). A `not_operator` refusal goes to
 * `AuthProvider` (back to /accedi).
 */
export function useHomeCardRead(): HomeCardRead {
  const service = useCardsService();
  const navigate = useNavigate();
  const { reportNotEnabled } = useAuth();
  const [state, setState] = useState<HomeCardState>({ status: 'idle' });
  // Set synchronously, so two reads in the same tick start a single lookup.
  const busy = useRef(false);
  const lastUid = useRef<string | null>(null);
  // An answer that arrives after the home is gone (the operator opened a customer) is dropped.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const lookUp = useCallback(
    (uid: string) => {
      if (busy.current) return;
      busy.current = true;
      lastUid.current = uid;
      setState({ status: 'reading' });
      service.lookup(uid).then(
        (found) => {
          busy.current = false;
          if (!mounted.current) return;
          switch (found.status) {
            case 'active':
              void navigate(`/clienti/${found.customerId}/spesa`);
              return;
            case 'unknown':
              // The uid in the history state, never in the URL (SPEC-customers-v2 point 6).
              void navigate('/clienti/nuovo', { state: newCustomerCardState(uid) });
              return;
            case 'inactive':
              setState({
                status: 'inactive',
                customerId: found.customerId,
                customerName: found.customerName,
              });
              return;
            case 'anonymized':
              setState({ status: 'anonymized' });
          }
        },
        (error: unknown) => {
          busy.current = false;
          if (!mounted.current) return;
          if (error instanceof CardsError && error.kind === 'not_operator') {
            setState({ status: 'idle' });
            void reportNotEnabled();
            return;
          }
          setState({ status: 'error', error });
        },
      );
    },
    [service, navigate, reportNotEnabled],
  );

  useCardRead((read: CardRead) => lookUp(read.uid), { enabled: state.status !== 'reading' });

  const retry = useCallback(() => {
    if (lastUid.current !== null) lookUp(lastUid.current);
  }, [lookUp]);

  return { ...state, retry };
}
