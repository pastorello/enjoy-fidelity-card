import type { CreateCustomerInput, CustomerSummary } from '../customers/types';

/** Whether the card holds the link to the points (SPEC-cards, "Modello dati"). */
export type LinkState = 'written' | 'not-written' | 'unverified';

/** What a card read means: no customer, a customer, or a customer whose data was erased. */
export type CardLookup =
  | { status: 'unknown' }
  | { status: 'active' | 'inactive'; cardId: string; customerId: string; customerName: string }
  | { status: 'anonymized'; cardId: string; customerId: string };

/** A row of `app.cards`, as the screens need it. Never a token: the database keeps none in clear. */
export type CardSummary = {
  id: string;
  /** Canonical uid (upper-case hex, no separators). */
  uid: string;
  customerId: string;
  active: boolean;
  associatedAt: string;
  deactivatedAt: string | null;
  /** When the link was written on the card and verified, or null. */
  linkWrittenAt: string | null;
  /** When the last link not confirmed yet was issued, or null. */
  linkPendingAt: string | null;
  linkState: LinkState;
};

/** What `associate` answers: the active card and the card it replaced, if any. */
export type CardAssociation = { card: CardSummary; replacedCardId: string | null };

export type CreateCustomerWithCardInput = CreateCustomerInput & { uid: string };

/** The customer a taken uid belongs to; `name` is null when that customer was anonymized. */
export type CardOwner = { customerId: string; name: string | null; active: boolean };

/** Why a `CardsService` call failed: the server's code, no answer at all, or anything else. */
export type CardsErrorKind =
  | 'not_operator'
  | 'invalid_uid'
  | 'customer_not_found'
  | 'customer_anonymized'
  | 'card_taken'
  | 'card_not_found'
  | 'card_inactive'
  | 'link_token_mismatch'
  | 'network'
  | 'unknown';

/**
 * Why a `CardsService` call failed. Its message never carries a uid, a token or a name, so it can be
 * logged; the subclasses below let callers tell the outcomes apart with `instanceof`.
 */
export class CardsError extends Error {
  readonly kind: CardsErrorKind;

  constructor(kind: CardsErrorKind) {
    super(`Card request failed (${kind})`);
    this.name = 'CardsError';
    this.kind = kind;
  }
}

/** The account is no longer an active operator: the screens call `reportNotEnabled()`. */
export class NotOperatorError extends CardsError {
  constructor() {
    super('not_operator');
    this.name = 'NotOperatorError';
  }
}

/** No answer from the server: the request may or may not have arrived. */
export class NetworkError extends CardsError {
  constructor() {
    super('network');
    this.name = 'NetworkError';
  }
}

/** The uid is not canonical (the app always normalizes it: a bug if it happens). */
export class InvalidUidError extends CardsError {
  constructor() {
    super('invalid_uid');
    this.name = 'InvalidUidError';
  }
}

/** The uid belongs to another customer, forever. `owner` is null when the server did not say. */
export class CardTakenError extends CardsError {
  readonly owner: CardOwner | null;

  constructor(owner: CardOwner | null) {
    super('card_taken');
    this.name = 'CardTakenError';
    this.owner = owner;
  }
}

/** The customer cannot get a card: it does not exist, or its data was erased. */
export class CustomerUnavailableError extends CardsError {
  readonly reason: 'not-found' | 'anonymized';

  constructor(reason: 'not-found' | 'anonymized') {
    super(reason === 'not-found' ? 'customer_not_found' : 'customer_anonymized');
    this.name = 'CustomerUnavailableError';
    this.reason = reason;
  }
}

export class CardNotFoundError extends CardsError {
  constructor() {
    super('card_not_found');
    this.name = 'CardNotFoundError';
  }
}

/** The card was deactivated (replaced, lost, customer erased): no link can be issued or confirmed. */
export class CardInactiveError extends CardsError {
  constructor() {
    super('card_inactive');
    this.name = 'CardInactiveError';
  }
}

/** The token is not the pending one any more (a newer issue replaced it) nor the written one. */
export class LinkTokenMismatchError extends CardsError {
  constructor() {
    super('link_token_mismatch');
    this.name = 'LinkTokenMismatchError';
  }
}

/**
 * Everything the cards feature needs from the backend. Every method rejects with a `CardsError`, a
 * `ServerFaultError`, or (only `createCustomerWithCard`, for the form's own errors) a
 * `CustomerError`. The app uses the Supabase implementation; tests pass a fake.
 */
export type CardsService = {
  /** What the card with this canonical uid is. */
  lookup(uid: string): Promise<CardLookup>;
  /** The customer's active card, or null. */
  getActiveCard(customerId: string): Promise<CardSummary | null>;
  /** Gives the customer this card, replacing the active one; repeating it changes nothing. */
  associate(customerId: string, uid: string): Promise<CardAssociation>;
  /** Repeating it on a deactivated card changes nothing. */
  deactivate(cardId: string): Promise<CardSummary>;
  /** All or nothing, idempotent on `operationId` like `CustomerService.create`. */
  createCustomerWithCard(input: CreateCustomerWithCardInput): Promise<CustomerSummary>;
  /**
   * A new pending token for the card's link. Keep it only in memory, only until it is written and
   * confirmed: never in the DOM, the router state, storage or logs.
   */
  issueLink(cardId: string): Promise<string>;
  /** The token read back from the card: it becomes the valid link. Idempotent with the same token. */
  confirmLink(cardId: string, token: string): Promise<CardSummary>;
};
