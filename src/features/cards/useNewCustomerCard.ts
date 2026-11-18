import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { normalizeUid } from '../card-input/normalizeUid';
import type { SaveCustomerVia } from '../customers/useSaveCustomer';
import { useAuth } from '../identity/AuthProvider';
import { useCardsService } from './CardsServiceProvider';
import { CardTakenError, CardsError, type CardLookup, type CardOwner } from './types';

/** The lookup of the last card read on the page (SPEC-cards, point 3). */
export type NewCustomerCardLookup =
  | { status: 'idle' }
  /** `lookup` in progress: other reads are dropped until it ends. */
  | { status: 'reading' }
  /** The lookup failed: `retryLookup` repeats it with the same uid (a read, never a duplicate). */
  | { status: 'error'; error: unknown };

export type NewCustomerCard = {
  /** The canonical uid saved with the customer, or null (the form has no card). */
  uid: string | null;
  /**
   * `link`: `?card=UID` from the home (point 2), Registra spesa opens after the save; `read`: read
   * on this page without `?card` (point 3), the customer page opens as in `customers`.
   */
  source: 'link' | 'read' | null;
  /** "Card già associata": the card read is known, or `card_taken` refused the save. */
  taken: { owner: CardOwner | null } | null;
  /** How Nuovo cliente saves with the card; null without one. */
  via: SaveCustomerVia | null;
  lookup: NewCustomerCardLookup;
  /** A card read on the page (canonical uid): the last one read counts. */
  read: (uid: string) => void;
  retryLookup: () => void;
  /** "Continua senza card": drops `?card` and stays in the form, its data intact. */
  continueWithoutCard: () => void;
};

/** Who a known card belongs to, as "Card già associata" names it. */
function ownerOf(found: Exclude<CardLookup, { status: 'unknown' }>): CardOwner {
  if (found.status === 'anonymized') {
    return { customerId: found.customerId, name: null, active: false };
  }
  return {
    customerId: found.customerId,
    name: found.customerName,
    active: found.status === 'active',
  };
}

/**
 * The card of Nuovo cliente (SPEC-cards, points 2 and 3). `?card=UID` (from the home, normalized
 * like a Web NFC read; an invalid one is ignored) or a card read on the page is created with the
 * customer by `createCustomerWithCard` with the form's `operation_id`. A read is looked up: an
 * unknown card becomes the card of the form (on `?card`, it replaces the link's card), a known one
 * (active, deactivated, of an erased customer) shows "Card già associata" and leaves the form
 * without a card. `card_taken` creates nothing: the page shows the owner; with `?card` the operator
 * continues without the card explicitly, whose save reuses the same `operation_id`. A
 * `not_operator` refusal goes to `AuthProvider`.
 */
export function useNewCustomerCard(): NewCustomerCard {
  const service = useCardsService();
  const { reportNotEnabled } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('card');
  const linkUid = raw === null ? null : normalizeUid(raw, 'hex');
  const [readUid, setReadUid] = useState<string | null>(null);
  const [taken, setTaken] = useState<NewCustomerCard['taken']>(null);
  const [lookup, setLookup] = useState<NewCustomerCardLookup>({ status: 'idle' });
  const uid = linkUid ?? readUid;
  const source = linkUid !== null ? 'link' : readUid !== null ? 'read' : null;

  // Set synchronously, so two reads in the same tick start a single lookup.
  const busy = useRef(false);
  const lastUid = useRef<string | null>(null);
  // An answer that arrives after the page is gone is dropped.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setLinkCard = useCallback(
    (card: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (card === null) next.delete('card');
          else next.set('card', card);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const read = useCallback(
    (card: string) => {
      if (busy.current) return;
      busy.current = true;
      lastUid.current = card;
      setLookup({ status: 'reading' });
      service.lookup(card).then(
        (found) => {
          busy.current = false;
          if (!mounted.current) return;
          setLookup({ status: 'idle' });
          if (found.status === 'unknown') {
            setTaken(null);
            if (linkUid !== null) setLinkCard(card);
            else setReadUid(card);
            return;
          }
          // The last card read counts: a known one leaves the form without a card.
          setTaken({ owner: ownerOf(found) });
          setReadUid(null);
          if (linkUid !== null) setLinkCard(null);
        },
        (error: unknown) => {
          busy.current = false;
          if (!mounted.current) return;
          if (error instanceof CardsError && error.kind === 'not_operator') {
            setLookup({ status: 'idle' });
            void reportNotEnabled();
            return;
          }
          setLookup({ status: 'error', error });
        },
      );
    },
    [service, linkUid, setLinkCard, reportNotEnabled],
  );

  const retryLookup = useCallback(() => {
    if (lastUid.current !== null) read(lastUid.current);
  }, [read]);

  const via = useMemo<SaveCustomerVia | null>(() => {
    if (uid === null) return null;
    return {
      create: (input) => service.createCustomerWithCard({ ...input, uid }),
      destination: (customer) =>
        linkUid !== null ? `/clienti/${customer.id}/spesa` : `/clienti/${customer.id}`,
      onOtherError: (error) => {
        if (error instanceof CardTakenError) {
          setTaken({ owner: error.owner });
          // A card read on the page is dropped with the notice; `?card` waits for "Continua senza card".
          setReadUid(null);
          return true;
        }
        if (error instanceof CardsError && error.kind === 'not_operator') {
          void reportNotEnabled();
          return true;
        }
        return false;
      },
    };
  }, [uid, linkUid, service, reportNotEnabled]);

  const continueWithoutCard = useCallback(() => {
    setTaken(null);
    setLinkCard(null);
  }, [setLinkCard]);

  return {
    uid,
    source,
    taken,
    via,
    lookup,
    read,
    retryLookup,
    continueWithoutCard,
  };
}
