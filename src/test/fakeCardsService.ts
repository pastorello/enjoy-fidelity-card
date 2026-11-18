import { vi } from 'vitest';
import { linkStateOf } from '../features/cards/linkState';
import {
  CardInactiveError,
  CardNotFoundError,
  CardTakenError,
  CardsError,
  CustomerUnavailableError,
  InvalidUidError,
  LinkTokenMismatchError,
  NetworkError,
  NotOperatorError,
} from '../features/cards/types';
import type {
  CardAssociation,
  CardLookup,
  CardSummary,
  CardsErrorKind,
  CardsService,
} from '../features/cards/types';
import type { CustomerSummary } from '../features/customers/types';
import { createFakeCustomerService } from './fakeCustomerService';

type Method = keyof CardsService;

/**
 * What a programmed call does instead of answering: reject with the typed error of that
 * `CardsErrorKind` (`card_taken` without an owner) or with that error (a `ServerFaultError`, a
 * `CardTakenError` with its owner, a `CustomerError`) without changing anything, or `'lost'`: the
 * call reaches the server and is applied, but the answer never arrives (rejects with `network`).
 */
export type FakeCardsFailure = CardsErrorKind | 'lost' | Error;

/** One logged call: the method and the arguments it received. */
export type FakeCardsCall = { method: Method; args: unknown[] };

type FakeCustomers = ReturnType<typeof createFakeCustomerService>;

type FakeOptions = {
  /** The customers the cards belong to; a new empty fake when missing (returned as `customers`). */
  customers?: FakeCustomers;
  cards?: CardSummary[];
  /** False: the account is not an active operator, and every call is `not_operator`. */
  operator?: boolean;
};

/** A card as the fake keeps it: the row, and the two tokens the server keeps as fingerprints. */
type StoredCard = Omit<CardSummary, 'linkState'> & {
  written: string | null;
  pending: string | null;
};

// private.is_card_uid: upper-case hex, no separators, 4 to 10 whole bytes, not all zeros.
const CARD_UID = /^(?:[0-9A-F]{2}){4,10}$/;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const CLOCK_START = Date.parse('2026-11-17T12:00:00.000Z');
let nextFixture = 0;

function isCardUid(uid: string): boolean {
  return CARD_UID.test(uid) && !/^0+$/.test(uid);
}

/** A card as the server returns it, active and with no link, with a fresh UUID-shaped id. */
export function fakeCard(overrides: Partial<CardSummary> = {}): CardSummary {
  nextFixture += 1;
  const card = {
    id: `00000000-0000-4000-a000-${String(nextFixture).padStart(12, '0')}`,
    uid: `04AABBCC${String(nextFixture).padStart(6, '0')}`,
    customerId: '00000000-0000-4000-8000-000000000001',
    active: true,
    associatedAt: '2026-11-17T10:00:00.000Z',
    deactivatedAt: null,
    linkWrittenAt: null,
    linkPendingAt: null,
    ...overrides,
  };
  return { ...card, linkState: linkStateOf(card.linkWrittenAt, card.linkPendingAt) };
}

function summary(card: StoredCard): CardSummary {
  const { written: _written, pending: _pending, ...row } = card;
  return { ...row, linkState: linkStateOf(row.linkWrittenAt, row.linkPendingAt) };
}

/** The typed error each programmed failure kind stands for. */
const ERRORS: Record<CardsErrorKind, () => CardsError> = {
  not_operator: () => new NotOperatorError(),
  invalid_uid: () => new InvalidUidError(),
  customer_not_found: () => new CustomerUnavailableError('not-found'),
  customer_anonymized: () => new CustomerUnavailableError('anonymized'),
  card_taken: () => new CardTakenError(null),
  card_not_found: () => new CardNotFoundError(),
  card_inactive: () => new CardInactiveError(),
  link_token_mismatch: () => new LinkTokenMismatchError(),
  network: () => new NetworkError(),
  unknown: () => new CardsError('unknown'),
};

function perMethod<T>(make: () => T): Record<Method, T> {
  return {
    lookup: make(),
    getActiveCard: make(),
    associate: make(),
    deactivate: make(),
    createCustomerWithCard: make(),
    issueLink: make(),
    confirmLink: make(),
  };
}

/**
 * In-memory CardsService for component tests, following the rules of the cards migration: a uid
 * belongs to one customer forever (`card_taken` with its owner, no name when anonymized), one
 * active card per customer (associating another one replaces it, the customer's own deactivated
 * card is reactivated), any deactivation clears the link, the anonymization of a customer in the
 * customers fake deactivates its card, a pending token becomes the written link only when
 * confirmed, `createCustomerWithCard` is all or nothing and idempotent on `operationId` (it
 * creates the customer in the customers fake). Every method is a `vi.fn` and every call is also
 * logged in `calls`. `failNext` programs a failure (also an answer lost after the call was
 * applied), `holdNext` delays an answer until released, `setNetworkDown` makes every call fail
 * with `network`.
 */
export function createFakeCardsService({
  customers = createFakeCustomerService(),
  cards: initial = [],
  operator = true,
}: FakeOptions = {}) {
  const stored = new Map<string, StoredCard>(
    initial.map(({ linkState: _linkState, ...row }) => [
      row.id,
      { ...row, written: null, pending: null },
    ]),
  );
  let created = 0;
  let issued = 0;
  let ticks = 0;
  let networkDown = false;
  const failures = perMethod<FakeCardsFailure[]>(() => []);
  const holds = perMethod<Promise<void>[]>(() => []);
  const calls: FakeCardsCall[] = [];

  /** A later instant at every call, so the order of the link instants is always clear. */
  function now(): string {
    ticks += 1;
    return new Date(CLOCK_START + ticks * 1000).toISOString();
  }

  function customerOf(id: string): CustomerSummary | null {
    return customers.customers().find((customer) => customer.id === id) ?? null;
  }

  function deactivate(card: StoredCard) {
    Object.assign(card, {
      active: false,
      deactivatedAt: now(),
      linkWrittenAt: null,
      linkPendingAt: null,
      written: null,
      pending: null,
    });
  }

  /** `customers_after_anonymize`: the card of a customer anonymized meanwhile stops working. */
  function syncAnonymized() {
    for (const card of stored.values()) {
      const customer = customerOf(card.customerId);
      if (card.active && customer && customer.anonymizedAt !== null) deactivate(card);
    }
  }

  function byUid(uid: string): StoredCard | null {
    return [...stored.values()].find((card) => card.uid === uid) ?? null;
  }

  function byId(cardId: string): StoredCard {
    const card = stored.get(cardId);
    if (!card) throw new CardNotFoundError();
    return card;
  }

  function cardTaken(card: StoredCard): CardTakenError {
    const owner = customerOf(card.customerId);
    const name = owner && owner.anonymizedAt === null ? owner.name : null;
    return new CardTakenError({ customerId: card.customerId, name, active: card.active });
  }

  /** The checks of `private.associate_card_to`, in its order, before anything changes. */
  function checkAssociation(customerId: string | null, uid: string) {
    if (!isCardUid(uid)) throw new InvalidUidError();
    if (customerId !== null) {
      const customer = customerOf(customerId);
      if (!customer) throw new CustomerUnavailableError('not-found');
      if (customer.anonymizedAt !== null) throw new CustomerUnavailableError('anonymized');
    }
    const card = byUid(uid);
    if (card && card.customerId !== customerId) throw cardTaken(card);
    return card;
  }

  function associate(customerId: string, uid: string): CardAssociation {
    const existing = checkAssociation(customerId, uid);
    if (existing?.active) return { card: summary(existing), replacedCardId: null };
    const replaced = [...stored.values()].find(
      (card) => card.customerId === customerId && card.active,
    );
    if (replaced) deactivate(replaced);
    let card = existing;
    if (card) {
      Object.assign(card, { active: true, deactivatedAt: null, associatedAt: now() });
    } else {
      created += 1;
      card = {
        id: `00000000-0000-4000-b000-${String(created).padStart(12, '0')}`,
        uid,
        customerId,
        active: true,
        associatedAt: now(),
        deactivatedAt: null,
        linkWrittenAt: null,
        linkPendingAt: null,
        written: null,
        pending: null,
      };
      stored.set(card.id, card);
    }
    return { card: summary(card), replacedCardId: replaced?.id ?? null };
  }

  function activeById(cardId: string): StoredCard {
    const card = byId(cardId);
    if (!card.active) throw new CardInactiveError();
    return card;
  }

  /** A fresh 22-character token in the alphabet of the real ones. */
  function newToken(): string {
    issued += 1;
    return `fakeLinkToken_${String(issued).padStart(8, '0')}`;
  }

  /** Logs the call, then answers it as programmed (network, failure, hold) or with `compute`. */
  function run<T>(method: Method, args: unknown[], compute: () => T): Promise<T> {
    calls.push({ method, args });
    const failure = failures[method].shift();
    const hold = holds[method].shift();
    const down = networkDown;
    // Built only when it is due, so a held rejection is never left unhandled meanwhile.
    const answer = async () => {
      if (down) throw new NetworkError();
      if (failure instanceof Error) throw failure;
      if (failure !== undefined && failure !== 'lost') throw ERRORS[failure]();
      if (!operator) throw new NotOperatorError();
      syncAnonymized();
      const result = compute();
      if (failure === 'lost') throw new NetworkError();
      return result;
    };
    return hold ? hold.then(answer) : answer();
  }

  const service = {
    lookup: vi.fn<CardsService['lookup']>((uid) =>
      run('lookup', [uid], (): CardLookup => {
        if (!isCardUid(uid)) throw new InvalidUidError();
        const card = byUid(uid);
        if (!card) return { status: 'unknown' };
        const customer = customerOf(card.customerId);
        if (!customer) throw new Error('fakeCardsService: a card of a missing customer');
        const { id: cardId, customerId } = card;
        if (customer.anonymizedAt !== null) return { status: 'anonymized', cardId, customerId };
        const status = card.active ? 'active' : 'inactive';
        return { status, cardId, customerId, customerName: customer.name };
      }),
    ),
    getActiveCard: vi.fn<CardsService['getActiveCard']>((customerId) =>
      run('getActiveCard', [customerId], () => {
        const card = [...stored.values()].find(
          (row) => row.customerId === customerId && row.active,
        );
        return card ? summary(card) : null;
      }),
    ),
    associate: vi.fn<CardsService['associate']>((customerId, uid) =>
      run('associate', [customerId, uid], () => associate(customerId, uid)),
    ),
    deactivate: vi.fn<CardsService['deactivate']>((cardId) =>
      run('deactivate', [cardId], () => {
        const card = byId(cardId);
        if (card.active) deactivate(card);
        return summary(card);
      }),
    ),
    createCustomerWithCard: vi.fn<CardsService['createCustomerWithCard']>((input) =>
      run('createCustomerWithCard', [input], () => {
        // A resent request returns the customer the first one created, without touching cards.
        const resent = customers.createdFor(input.operationId);
        if (resent) return resent;
        if (!isCardUid(input.uid)) throw new InvalidUidError();
        const { uid, ...customerInput } = input;
        const commit = customers.prepareCreate(customerInput);
        // A new customer has no card: any card with this uid belongs to someone else.
        checkAssociation(null, uid);
        const customer = commit();
        associate(customer.id, uid);
        return customer;
      }),
    ),
    issueLink: vi.fn<CardsService['issueLink']>((cardId) =>
      run('issueLink', [cardId], () => {
        const card = activeById(cardId);
        const token = newToken();
        Object.assign(card, { pending: token, linkPendingAt: now() });
        return token;
      }),
    ),
    confirmLink: vi.fn<CardsService['confirmLink']>((cardId, token) =>
      run('confirmLink', [cardId, token], () => {
        const card = activeById(cardId);
        if (!TOKEN.test(token)) throw new LinkTokenMismatchError();
        if (card.written === token) return summary(card);
        if (card.pending !== token) throw new LinkTokenMismatchError();
        Object.assign(card, {
          written: token,
          pending: null,
          linkWrittenAt: now(),
          linkPendingAt: null,
        });
        return summary(card);
      }),
    ),
  } satisfies CardsService;

  return {
    service,
    /** The customers fake the cards read (and `createCustomerWithCard` writes). */
    customers,
    /** Every call, in order, with its arguments. */
    calls,
    /** The stored cards, as the server would return them, in insertion order. */
    cards: () => {
      syncAnonymized();
      return [...stored.values()].map(summary);
    },
    /** The written and pending tokens of a card (the server keeps only their fingerprints). */
    tokens: (cardId: string) => {
      syncAnonymized();
      const card = byId(cardId);
      return { written: card.written, pending: card.pending };
    },
    /** Programs the next call of `method` (queued: one failure per call, in order). */
    failNext(method: Method, failure: FakeCardsFailure) {
      failures[method].push(failure);
    },
    /** Delays the answer of the next call of `method` until `release()`. */
    holdNext(method: Method) {
      let release!: () => void;
      holds[method].push(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return { release };
    },
    /** While down, every call rejects with `network` and changes nothing. */
    setNetworkDown(down: boolean) {
      networkDown = down;
    },
  };
}
