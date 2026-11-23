import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import { toCustomerSummary } from '../customers/customerRow';
import { isCustomerErrorCode, pointsAtExistingCustomer } from '../customers/errorCodes';
import { CustomerError } from '../customers/types';
import { linkStateOf } from './linkState';
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
import type { CardLookup, CardOwner, CardSummary, CardsService } from './types';

// The only module that reads app.cards or calls the cards RPCs. No message it produces carries a
// uid, a token or a name: errors are built from the server's code alone, never from its text.

/** The parts of a supabase-js answer this module looks at. */
type Answer = {
  data: unknown;
  error: { code?: string; message?: string; details?: string | null } | null;
  status: number;
};

/** The columns of app.cards a `CardSummary` needs; never `*`. */
const CARD_COLUMNS =
  'id, uid, customer_id, active, associated_at, deactivated_at, link_written_at, link_pending_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

/**
 * The message-codes the cards migration raises (errcode P0001). `scripts/cardErrorCodes.test.ts`
 * checks the list against the migration; the type below makes `TRANSLATIONS` cover each one.
 */
export const CARD_ERROR_CODES = [
  'not_operator',
  'invalid_uid',
  'customer_not_found',
  'customer_anonymized',
  'card_taken',
  'card_not_found',
  'card_inactive',
  'link_token_mismatch',
] as const;

type CardErrorCode = (typeof CARD_ERROR_CODES)[number];

/** The typed error each code becomes; `details` is the server's detail, used only by card_taken. */
const TRANSLATIONS: Record<CardErrorCode, (details: string | null) => CardsError> = {
  not_operator: () => new NotOperatorError(),
  invalid_uid: () => new InvalidUidError(),
  customer_not_found: () => new CustomerUnavailableError('not-found'),
  customer_anonymized: () => new CustomerUnavailableError('anonymized'),
  card_taken: (details) => new CardTakenError(ownerOf(details)),
  card_not_found: () => new CardNotFoundError(),
  card_inactive: () => new CardInactiveError(),
  link_token_mismatch: () => new LinkTokenMismatchError(),
};

function isCardErrorCode(value: string): value is CardErrorCode {
  return CARD_ERROR_CODES.some((code) => code === value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function record(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  return { ...data };
}

/** The owner in the JSON detail of `card_taken`, or null when it is missing or malformed. */
function ownerOf(details: string | null): CardOwner | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(details ?? '');
  } catch {
    return null;
  }
  const detail = record(parsed);
  if (!detail) return null;
  const { owner_id: customerId, owner_name: name, active } = detail;
  if (typeof customerId !== 'string' || !UUID.test(customerId)) return null;
  if (!isNullableString(name) || typeof active !== 'boolean') return null;
  return { customerId, name, active };
}

/** Maps an `app.cards` row (snake_case), or null when its shape is unexpected. */
function toCard(data: unknown): CardSummary | null {
  const row = record(data);
  if (!row) return null;
  const { id, uid, active } = row;
  const { customer_id: customerId, associated_at: associatedAt } = row;
  const { deactivated_at: deactivatedAt, link_written_at: linkWrittenAt } = row;
  const { link_pending_at: linkPendingAt } = row;
  if (
    typeof id !== 'string' ||
    typeof uid !== 'string' ||
    typeof customerId !== 'string' ||
    typeof active !== 'boolean' ||
    typeof associatedAt !== 'string' ||
    !isNullableString(deactivatedAt) ||
    !isNullableString(linkWrittenAt) ||
    !isNullableString(linkPendingAt)
  ) {
    return null;
  }
  return {
    id,
    uid,
    customerId,
    active,
    associatedAt,
    deactivatedAt,
    linkWrittenAt,
    linkPendingAt,
    linkState: linkStateOf(linkWrittenAt, linkPendingAt),
  };
}

/** Maps a row of `app.lookup_card`, or null when its shape is unexpected. */
function toLookup(data: unknown): CardLookup | null {
  const row = record(data);
  if (!row) return null;
  const { card_id: cardId, customer_id: customerId, customer_name: customerName } = row;
  const { active, customer_anonymized: anonymized } = row;
  if (typeof cardId !== 'string' || typeof customerId !== 'string') return null;
  if (typeof active !== 'boolean' || typeof anonymized !== 'boolean') return null;
  if (anonymized) return { status: 'anonymized', cardId, customerId };
  if (typeof customerName !== 'string') return null;
  return { status: active ? 'active' : 'inactive', cardId, customerId, customerName };
}

/** The error to reject with, or null when the answer carries data. */
function failureOf(answer: Answer): Error | null {
  const { error, status } = answer;
  if (!error) return null;
  // supabase-js answers a failed fetch with status 0 instead of throwing.
  if (status === 0) return new NetworkError();
  const fault = serverFaultFor(error, status);
  if (fault) return new ServerFaultError(fault);
  const code = error.message ?? '';
  if (error.code !== 'P0001') return new CardsError('unknown');
  if (isCardErrorCode(code)) return TRANSLATIONS[code](error.details ?? null);
  // create_customer_with_card runs app.create_customer: its refusals belong to the customer form.
  if (isCustomerErrorCode(code)) {
    const existing = pointsAtExistingCustomer(code) ? (error.details ?? '') : '';
    return new CustomerError(code, UUID.test(existing) ? existing : null);
  }
  return new CardsError('unknown');
}

/** Sends a request; never lets a thrown fetch error out as anything but `NetworkError`. */
async function send(request: () => PromiseLike<Answer>): Promise<unknown> {
  let answer: Answer;
  try {
    answer = await request();
  } catch {
    throw new NetworkError();
  }
  const failure = failureOf(answer);
  if (failure) throw failure;
  return answer.data;
}

function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  return send(() => getSupabase().schema('app').rpc(fn, args));
}

/** The mapped value, or a rejection with `unknown` when the answer had an unexpected shape. */
function expected<T>(value: T | null): T {
  if (value === null) throw new CardsError('unknown');
  return value;
}

export const supabaseCardsService: CardsService = {
  async lookup(uid) {
    const data = await call('lookup_card', { p_uid: uid });
    if (!Array.isArray(data) || data.length > 1) throw new CardsError('unknown');
    const rows: unknown[] = data;
    if (rows.length === 0) return { status: 'unknown' };
    return expected(toLookup(rows[0]));
  },

  async getActiveCard(customerId) {
    const data = await send(() =>
      getSupabase()
        .schema('app')
        .from('cards')
        .select(CARD_COLUMNS)
        .eq('customer_id', customerId)
        .eq('active', true),
    );
    if (!Array.isArray(data) || data.length > 1) throw new CardsError('unknown');
    const rows: unknown[] = data;
    return rows.length === 0 ? null : expected(toCard(rows[0]));
  },

  async associate(customerId, uid) {
    const data = await call('associate_card', { p_customer_id: customerId, p_uid: uid });
    const card = expected(toCard(data));
    const replaced = record(data)?.replaced_card_id;
    if (replaced !== null && typeof replaced !== 'string') throw new CardsError('unknown');
    return { card, replacedCardId: replaced };
  },

  async deactivate(cardId) {
    return expected(toCard(await call('deactivate_card', { p_card_id: cardId })));
  },

  async createCustomerWithCard({ operationId, name, phone, privacyConsent, notes, uid }) {
    const data = await call('create_customer_with_card', {
      p_operation_id: operationId,
      p_name: name,
      p_phone: phone,
      p_privacy_consent: privacyConsent,
      p_notes: notes,
      p_uid: uid,
    });
    return expected(toCustomerSummary(data));
  },

  async issueLink(cardId) {
    const token = await call('issue_card_link', { p_card_id: cardId });
    if (typeof token !== 'string' || !TOKEN.test(token)) throw new CardsError('unknown');
    return token;
  },

  async confirmLink(cardId, token) {
    return expected(toCard(await call('confirm_card_link', { p_card_id: cardId, p_token: token })));
  },
};
