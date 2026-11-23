import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import { CUSTOMER_ERROR_CODES } from '../customers/errorCodes';
import { CustomerError } from '../customers/types';
import type { CustomerSummary } from '../customers/types';
import { CARD_ERROR_CODES, supabaseCardsService } from './supabaseCardsService';
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
} from './types';
import type { CardSummary } from './types';

type Answer = { data: unknown; error: unknown; status: number };

const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: unknown) => Promise<unknown>>(),
  from: vi.fn<(table: string) => unknown>(),
  select: vi.fn<(columns: string) => unknown>(),
  eq: vi.fn<(column: string, value: unknown) => unknown>(),
  answer: vi.fn<() => Promise<unknown>>(),
}));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ schema: db.schema }),
}));

const CARD_ID = '3c7d9e1f-2a4b-4c6d-8e0f-1a2b3c4d5e6f';
const OLD_CARD_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const CUSTOMER_ID = '6f1c2a5e-8b3d-4c7a-9e21-0d4b5f6a7c8e';
const OWNER_ID = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b';
const OPERATOR_ID = 'd4c3b2a1-0f9e-4d8c-b7a6-5f4e3d2c1b0a';
const OPERATION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const UID = '04AABBCCDDEE01';
const TOKEN = 'Zq3_x-9KpL2mN8vR4tY6wA';

const cardRow = {
  id: CARD_ID,
  uid: UID,
  customer_id: CUSTOMER_ID,
  active: true,
  associated_at: '2026-11-18T09:00:00.123456+00:00',
  associated_by: OPERATOR_ID,
  deactivated_at: null,
  link_written_at: null,
  link_written_by: null,
  link_pending_at: null,
};
const card: CardSummary = {
  id: CARD_ID,
  uid: UID,
  customerId: CUSTOMER_ID,
  active: true,
  associatedAt: '2026-11-18T09:00:00.123456+00:00',
  deactivatedAt: null,
  linkWrittenAt: null,
  linkPendingAt: null,
  linkState: 'not-written',
};
const writtenRow = {
  ...cardRow,
  link_written_at: '2026-11-18T09:01:00+00:00',
  link_written_by: OPERATOR_ID,
};
const writtenCard: CardSummary = {
  ...card,
  linkWrittenAt: '2026-11-18T09:01:00+00:00',
  linkState: 'written',
};
const customerRow = {
  id: CUSTOMER_ID,
  name: 'Maria Rossi',
  notes: null,
  anonymized_at: null,
  balance: 0,
  last_served_at: null,
  email: 'maria.rossi@example.com',
};
const customer: CustomerSummary = {
  id: CUSTOMER_ID,
  name: 'Maria Rossi',
  notes: null,
  anonymizedAt: null,
  balance: 0,
  lastServedAt: null,
  email: 'maria.rossi@example.com',
};

/** An error raised by the app's functions, as PostgREST returns it. */
const raised = (message: string, details: string | null = null): Answer => ({
  data: null,
  error: { code: 'P0001', message, details, hint: null },
  status: 400,
});

const pgError = (code: string, status: number, message = 'error'): Answer => ({
  data: null,
  error: { code, message, details: null, hint: null },
  status,
});

/** What supabase-js returns when the request never got an answer (failed fetch). */
const noResponse: Answer = {
  data: null,
  error: { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' },
  status: 0,
};

const TAKEN_DETAIL = JSON.stringify({
  owner_id: OWNER_ID,
  owner_name: 'Maria Rossi',
  active: true,
});

/** `card_taken` with its JSON detail, as `private.raise_card_taken` sends it. */
const taken = (detail: unknown): Answer => raised('card_taken', JSON.stringify(detail));

/** Makes every call (RPC or table read) answer with `answer`. */
function answerWith(answer: Answer): void {
  db.rpc.mockResolvedValue(answer);
  db.answer.mockResolvedValue(answer);
}

/** Makes every call (RPC or table read) throw, as a fetch that never reached the server. */
function throwOnCall(): void {
  db.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
  db.answer.mockRejectedValue(new TypeError('Failed to fetch'));
}

beforeEach(() => {
  vi.resetAllMocks();
  // A PostgREST query builder: chainable, and awaitable for its answer (a promise with its methods).
  db.from.mockImplementation(() => {
    const query = Object.assign(db.answer(), {
      select: (columns: string) => (db.select(columns), query),
      eq: (column: string, value: unknown) => (db.eq(column, value), query),
    });
    return query;
  });
  db.schema.mockReturnValue({ rpc: db.rpc, from: db.from });
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
}

/** Every service call, with a well-formed answer and what it resolves to. */
const calls = [
  {
    name: 'lookup',
    run: () => supabaseCardsService.lookup(UID),
    data: [],
    result: { status: 'unknown' },
  },
  {
    name: 'getActiveCard',
    run: () => supabaseCardsService.getActiveCard(CUSTOMER_ID),
    data: [cardRow],
    result: card,
  },
  {
    name: 'associate',
    run: () => supabaseCardsService.associate(CUSTOMER_ID, UID),
    data: { ...cardRow, replaced_card_id: null },
    result: { card, replacedCardId: null },
  },
  {
    name: 'deactivate',
    run: () => supabaseCardsService.deactivate(CARD_ID),
    data: { ...cardRow, active: false, deactivated_at: '2026-11-18T10:00:00+00:00' },
    result: { ...card, active: false, deactivatedAt: '2026-11-18T10:00:00+00:00' },
  },
  {
    name: 'createCustomerWithCard',
    run: () =>
      supabaseCardsService.createCustomerWithCard({
        operationId: OPERATION_ID,
        name: 'Maria Rossi',
        email: '',
        privacyConsent: true,
        notes: '',
        uid: UID,
      }),
    data: customerRow,
    result: customer,
  },
  {
    name: 'issueLink',
    run: () => supabaseCardsService.issueLink(CARD_ID),
    data: TOKEN,
    result: TOKEN,
  },
  {
    name: 'confirmLink',
    run: () => supabaseCardsService.confirmLink(CARD_ID, TOKEN),
    data: writtenRow,
    result: writtenCard,
  },
] as const;

/** The typed error each message-code of the cards migration becomes. */
const translations = [
  ['not_operator', NotOperatorError],
  ['invalid_uid', InvalidUidError],
  ['customer_not_found', CustomerUnavailableError],
  ['customer_anonymized', CustomerUnavailableError],
  ['card_taken', CardTakenError],
  ['card_not_found', CardNotFoundError],
  ['card_inactive', CardInactiveError],
  ['link_token_mismatch', LinkTokenMismatchError],
] as const;

describe.each(calls)('$name', ({ run, data, result }) => {
  it('maps a well-formed answer', async () => {
    answerWith({ data, error: null, status: 200 });
    await expect(run()).resolves.toEqual(result);
    expect(db.schema).toHaveBeenCalledWith('app');
  });

  it.each(translations)('a raised %s is a %O', async (code, type) => {
    answerWith(raised(code));
    const error = await rejection(run());
    expect(error).toBeInstanceOf(type);
    expect(error).toBeInstanceOf(CardsError);
    expect(error).toMatchObject({ kind: code });
  });

  it('a failed fetch is a NetworkError', async () => {
    answerWith(noResponse);
    const error = await rejection(run());
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ kind: 'network' });
  });

  it('a throwing call is a NetworkError', async () => {
    throwOnCall();
    expect(await rejection(run())).toBeInstanceOf(NetworkError);
  });

  it.each([
    ['PGRST202', 404, 'Could not find the function', 'misconfigured'],
    ['PGRST205', 404, 'Could not find the table', 'misconfigured'],
    ['PGRST106', 406, 'Invalid schema: app', 'misconfigured'],
    ['42501', 401, 'permission denied for function issue_card_link', 'misconfigured'],
    ['PGRST002', 503, 'Could not query the database for the schema cache', 'unavailable'],
    ['', 503, 'Service Unavailable', 'unavailable'],
  ])('%s (HTTP %i) is a ServerFaultError', async (code, status, message, kind) => {
    answerWith(pgError(code, status, message));
    const error = await rejection(run());
    expect(error).toBeInstanceOf(ServerFaultError);
    expect(error).toMatchObject({ kind });
  });

  it.each([
    ['P0001', 400, 'some_future_code'],
    ['22023', 400, 'operation_id is required'],
    ['PGRST301', 401, 'JWT expired'],
    ['XX000', 500, 'internal error'],
  ])('any other error (%s, HTTP %i) is unknown', async (code, status, message) => {
    answerWith(pgError(code, status, message));
    const error = await rejection(run());
    expect(error).toBeInstanceOf(CardsError);
    expect(error).toMatchObject({ kind: 'unknown' });
  });

  it('an answer of unexpected shape is unknown', async () => {
    answerWith({ data: { unexpected: true }, error: null, status: 200 });
    expect(await rejection(run())).toMatchObject({ kind: 'unknown' });
  });

  it.each([
    ['card_taken with its owner', raised('card_taken', TAKEN_DETAIL)],
    ['an error quoting them', pgError('XX000', 500, `${UID} ${TOKEN} Maria Rossi`)],
    ['an unknown code that is the token', pgError('P0001', 400, TOKEN)],
    ['a failed fetch', noResponse],
  ])('keeps the uid, the token and names out of the error for %s', async (_name, answer) => {
    answerWith(answer);
    const error = await rejection(run());
    if (!(error instanceof Error)) throw new Error('expected an Error');
    // The owner's name travels as a property (the "Card già associata" screen shows it), never in
    // the message; the uid and the token are nowhere in the error.
    const message = `${error.name} ${error.message} ${String(error)} ${error.stack ?? ''}`;
    const everything = `${message} ${JSON.stringify(error)}`;
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(UID);
    expect(message).not.toContain('Maria');
    expect(error.cause).toBeUndefined();
  });
});

describe('arguments', () => {
  it.each([
    ['lookup', () => supabaseCardsService.lookup(UID), 'lookup_card', { p_uid: UID }],
    [
      'associate',
      () => supabaseCardsService.associate(CUSTOMER_ID, UID),
      'associate_card',
      { p_customer_id: CUSTOMER_ID, p_uid: UID },
    ],
    [
      'deactivate',
      () => supabaseCardsService.deactivate(CARD_ID),
      'deactivate_card',
      { p_card_id: CARD_ID },
    ],
    [
      'createCustomerWithCard',
      () =>
        supabaseCardsService.createCustomerWithCard({
          operationId: OPERATION_ID,
          name: 'Maria Rossi',
          email: 'Maria.Rossi@Example.com',
          privacyConsent: true,
          notes: 'Tavolo 4',
          uid: UID,
        }),
      'create_customer_with_card',
      {
        p_operation_id: OPERATION_ID,
        p_name: 'Maria Rossi',
        p_email: 'Maria.Rossi@Example.com',
        p_privacy_consent: true,
        p_notes: 'Tavolo 4',
        p_uid: UID,
      },
    ],
    [
      'issueLink',
      () => supabaseCardsService.issueLink(CARD_ID),
      'issue_card_link',
      { p_card_id: CARD_ID },
    ],
    [
      'confirmLink',
      () => supabaseCardsService.confirmLink(CARD_ID, TOKEN),
      'confirm_card_link',
      { p_card_id: CARD_ID, p_token: TOKEN },
    ],
  ] as const)('%s calls app.%s with snake_case arguments', async (_name, run, fn, args) => {
    answerWith({ data: null, error: null, status: 200 });
    await run().catch(() => undefined);
    expect(db.rpc).toHaveBeenCalledWith(fn, args);
  });

  it('getActiveCard reads the active card of the customer from app.cards', async () => {
    answerWith({ data: [], error: null, status: 200 });
    await expect(supabaseCardsService.getActiveCard(CUSTOMER_ID)).resolves.toBeNull();
    expect(db.from).toHaveBeenCalledWith('cards');
    expect(db.eq).toHaveBeenCalledWith('customer_id', CUSTOMER_ID);
    expect(db.eq).toHaveBeenCalledWith('active', true);
    const [columns] = db.select.mock.calls[0] ?? [''];
    expect(columns).not.toMatch(/\*/);
  });
});

describe('lookup', () => {
  const lookupRow = {
    card_id: CARD_ID,
    customer_id: CUSTOMER_ID,
    customer_name: 'Maria Rossi',
    active: true,
    customer_anonymized: false,
  };

  it.each([
    [
      'an active card',
      lookupRow,
      { status: 'active', cardId: CARD_ID, customerId: CUSTOMER_ID, customerName: 'Maria Rossi' },
    ],
    [
      'a deactivated card',
      { ...lookupRow, active: false },
      { status: 'inactive', cardId: CARD_ID, customerId: CUSTOMER_ID, customerName: 'Maria Rossi' },
    ],
    [
      'a card of an anonymized customer, with no name',
      { ...lookupRow, active: false, customer_name: null, customer_anonymized: true },
      { status: 'anonymized', cardId: CARD_ID, customerId: CUSTOMER_ID },
    ],
  ])('maps %s', async (_name, row, result) => {
    answerWith({ data: [row], error: null, status: 200 });
    await expect(supabaseCardsService.lookup(UID)).resolves.toEqual(result);
  });

  it('a known card of a customer that is not anonymized must carry a name', async () => {
    answerWith({ data: [{ ...lookupRow, customer_name: null }], error: null, status: 200 });
    expect(await rejection(supabaseCardsService.lookup(UID))).toMatchObject({ kind: 'unknown' });
  });
});

describe('cards', () => {
  it('computes the LinkState of each card from the two instants', async () => {
    answerWith({
      data: [{ ...writtenRow, link_pending_at: '2026-11-18T09:02:00+00:00' }],
      error: null,
      status: 200,
    });
    await expect(supabaseCardsService.getActiveCard(CUSTOMER_ID)).resolves.toMatchObject({
      linkState: 'unverified',
      linkPendingAt: '2026-11-18T09:02:00+00:00',
    });
  });

  it('associate passes on the card it replaced', async () => {
    answerWith({ data: { ...cardRow, replaced_card_id: OLD_CARD_ID }, error: null, status: 200 });
    await expect(supabaseCardsService.associate(CUSTOMER_ID, UID)).resolves.toEqual({
      card,
      replacedCardId: OLD_CARD_ID,
    });
  });

  it('issueLink accepts only a 22-character base64url token', async () => {
    answerWith({ data: 'not a token', error: null, status: 200 });
    const error = await rejection(supabaseCardsService.issueLink(CARD_ID));
    expect(error).toMatchObject({ kind: 'unknown' });
    expect(String(error)).not.toContain('not a token');
  });
});

describe('card_taken', () => {
  it('carries the owner from the detail', async () => {
    answerWith(taken({ owner_id: OWNER_ID, owner_name: 'Luca Bianchi', active: true }));
    const error = await rejection(supabaseCardsService.associate(CUSTOMER_ID, UID));
    expect(error).toBeInstanceOf(CardTakenError);
    expect(error).toMatchObject({
      owner: { customerId: OWNER_ID, name: 'Luca Bianchi', active: true },
    });
  });

  it('an anonymized owner has no name', async () => {
    answerWith(taken({ owner_id: OWNER_ID, owner_name: null, active: false }));
    expect(await rejection(supabaseCardsService.associate(CUSTOMER_ID, UID))).toMatchObject({
      owner: { customerId: OWNER_ID, name: null, active: false },
    });
  });

  it.each([null, 'not json', '{"owner_id":"x","owner_name":null,"active":true}', '[]'])(
    'a missing or malformed detail (%s) gives no owner',
    async (detail) => {
      answerWith(raised('card_taken', detail));
      const error = await rejection(supabaseCardsService.associate(CUSTOMER_ID, UID));
      expect(error).toBeInstanceOf(CardTakenError);
      expect(error).toMatchObject({ owner: null });
    },
  );
});

describe('customer unavailable', () => {
  it.each([
    ['customer_not_found', 'not-found'],
    ['customer_anonymized', 'anonymized'],
  ])('%s says why', async (code, reason) => {
    answerWith(raised(code));
    expect(await rejection(supabaseCardsService.associate(CUSTOMER_ID, UID))).toMatchObject({
      reason,
    });
  });
});

describe('createCustomerWithCard', () => {
  const input = {
    operationId: OPERATION_ID,
    name: 'maria rossi',
    email: '',
    privacyConsent: true,
    notes: '',
    uid: UID,
  };
  const formCodes = CUSTOMER_ERROR_CODES.filter(
    (code) => !CARD_ERROR_CODES.some((cardCode) => cardCode === code),
  );

  it.each(formCodes)(
    'a raised %s of app.create_customer stays a CustomerError, for the form',
    async (code) => {
      answerWith(raised(code));
      const error = await rejection(supabaseCardsService.createCustomerWithCard(input));
      expect(error).toBeInstanceOf(CustomerError);
      expect(error).toMatchObject({ kind: code });
    },
  );

  it('sends only its arguments and drops the attributes of customer_summary it does not know', async () => {
    answerWith({ data: { ...customerRow, future_column: null }, error: null, status: 200 });
    const created = await supabaseCardsService.createCustomerWithCard(input);
    expect(Object.keys(created).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'anonymizedAt',
      'balance',
      'email',
      'id',
      'lastServedAt',
      'name',
      'notes',
    ]);
    // Strict: no phone argument, not even left undefined (SPEC-customers-v2, point 1).
    expect(
      Object.keys(db.rpc.mock.calls[0]?.[1] ?? {}).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['p_email', 'p_name', 'p_notes', 'p_operation_id', 'p_privacy_consent', 'p_uid']);
  });

  it('customer_email_taken carries the customer that has the email', async () => {
    answerWith(raised('customer_email_taken', OWNER_ID));
    expect(await rejection(supabaseCardsService.createCustomerWithCard(input))).toMatchObject({
      kind: 'customer_email_taken',
      existingCustomerId: OWNER_ID,
    });
  });

  it('email_invalid is a CustomerError without an id', async () => {
    answerWith(raised('email_invalid', OWNER_ID));
    expect(await rejection(supabaseCardsService.createCustomerWithCard(input))).toMatchObject({
      kind: 'email_invalid',
      existingCustomerId: null,
    });
  });

  it('customer_name_taken carries the existing customer', async () => {
    answerWith(raised('customer_name_taken', OWNER_ID));
    expect(await rejection(supabaseCardsService.createCustomerWithCard(input))).toMatchObject({
      kind: 'customer_name_taken',
      existingCustomerId: OWNER_ID,
    });
  });
});
