import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { normalizeUid } from '../card-input/normalizeUid';
import type { SaveCustomerVia } from '../customers/useSaveCustomer';
import { useAuth } from '../identity/AuthProvider';
import { useCardsService } from './CardsServiceProvider';
import { CardTakenError, CardsError, type CardOwner } from './types';

export type NewCustomerCard = {
  /** The canonical uid of `?card=`, or null (missing or invalid: the form has no card). */
  uid: string | null;
  /** The card became another customer's meanwhile: its owner (null when the server did not say). */
  taken: { owner: CardOwner | null } | null;
  /** How Nuovo cliente saves with the card; null without one. */
  via: SaveCustomerVia | null;
  /** "Continua senza card": drops `?card` and stays in the form, its data intact. */
  continueWithoutCard: () => void;
};

/**
 * The card of Nuovo cliente from a new card (SPEC-cards, point 2): `?card=UID`, normalized like a
 * Web NFC read (an invalid one is ignored). The customer and the card are created together by
 * `createCustomerWithCard` with the form's `operation_id`, then Registra spesa replaces the form.
 * `card_taken` creates nothing: the page shows the owner and offers to continue without the card,
 * whose save reuses the same `operation_id`. A `not_operator` refusal goes to `AuthProvider`.
 */
export function useNewCustomerCard(): NewCustomerCard {
  const service = useCardsService();
  const { reportNotEnabled } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('card');
  const uid = raw === null ? null : normalizeUid(raw, 'hex');
  const [taken, setTaken] = useState<NewCustomerCard['taken']>(null);

  const via = useMemo<SaveCustomerVia | null>(() => {
    if (uid === null) return null;
    return {
      create: (input) => service.createCustomerWithCard({ ...input, uid }),
      destination: (customer) => `/clienti/${customer.id}/spesa`,
      onOtherError: (error) => {
        if (error instanceof CardTakenError) {
          setTaken({ owner: error.owner });
          return true;
        }
        if (error instanceof CardsError && error.kind === 'not_operator') {
          void reportNotEnabled();
          return true;
        }
        return false;
      },
    };
  }, [uid, service, reportNotEnabled]);

  const continueWithoutCard = useCallback(() => {
    setTaken(null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('card');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return { uid, taken: uid === null ? null : taken, via, continueWithoutCard };
}
