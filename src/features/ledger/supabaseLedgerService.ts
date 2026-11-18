import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import { LedgerError } from './types';
import type {
  LedgerErrorKind,
  LedgerResult,
  LedgerService,
  Movement,
  MovementCursor,
  MovementKind,
} from './types';

// The only module that reads app.movement_history or calls the ledger RPCs. No message it produces
// carries a name or an amount: errors are built from the server's code alone, never from its text.

/** A request without an answer within 8 s counts as no connection (SPEC-ledger, Open Question 13). */
export const REQUEST_TIMEOUT_MS = 8000;

/** One page of Movimenti; the customer's page asks for 4. */
const PAGE_SIZE = 50;

/**
 * The SQLSTATEs the ledger RPCs raise (docs/specs/SPEC-ledger.md, "Errori → servizio") and their
 * translation. `scripts/ledgerErrorCodes.test.ts` checks the list against the migration.
 */
export const LEDGER_ERRCODES: Readonly<Record<string, LedgerErrorKind>> = {
  EC001: 'insufficient-balance',
  EC002: 'already-cancelled',
  EC003: 'cancel-window-expired',
  EC004: 'not-cancellable',
  EC005: 'reward-unavailable',
  EC006: 'customer-unavailable',
  EC007: 'conflict',
  '42501': 'forbidden',
  '22023': 'invalid',
};

/** The columns of app.movement_history a `Movement` needs; never `*`. */
const COLUMNS = [
  'id',
  'operation_id',
  'customer_id',
  'kind',
  'amount_cents',
  'points',
  'cents_per_point',
  'reward_id',
  'description',
  'operator_id',
  'operator_name',
  'created_at',
  'corrects_movement_id',
  'cancelled_by_id',
  'cancelled_at',
  'corrected_kind',
  'corrected_created_at',
].join(', ');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A timestamptz as PostgREST writes it; the cursor goes into a filter, so nothing else passes. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;

/** The parts of a supabase-js answer this module looks at. */
type Answer = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  status?: number;
};

/** A supabase-js builder: awaitable and cancellable. */
type Request = PromiseLike<Answer> & { abortSignal(signal: AbortSignal): PromiseLike<Answer> };

function record(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  return { ...data };
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);
const isNullableInteger = (value: unknown): value is number | null =>
  value === null || isInteger(value);

function kindOf(value: unknown): MovementKind | null {
  return value === 'purchase' || value === 'redemption' || value === 'correction' ? value : null;
}

/** Maps a row of `app.movement_history` (snake_case), or null when its shape is unexpected. */
function toMovement(data: unknown): Movement | null {
  const row = record(data);
  if (!row) return null;
  const kind = kindOf(row.kind);
  const correctedKind = row.corrected_kind === null ? null : kindOf(row.corrected_kind);
  const {
    id,
    operation_id: operationId,
    customer_id: customerId,
    amount_cents: amountCents,
    points,
    cents_per_point: centsPerPoint,
    reward_id: rewardId,
    description,
    operator_id: operatorId,
    operator_name: operatorName,
    created_at: createdAt,
    corrects_movement_id: correctsMovementId,
    cancelled_by_id: cancelledById,
    cancelled_at: cancelledAt,
    corrected_created_at: correctedCreatedAt,
  } = row;
  if (
    !kind ||
    correctedKind === 'correction' ||
    (row.corrected_kind !== null && correctedKind === null) ||
    !isString(id) ||
    !isString(operationId) ||
    !isString(customerId) ||
    !isNullableInteger(amountCents) ||
    !isInteger(points) ||
    !isNullableInteger(centsPerPoint) ||
    !isNullableString(rewardId) ||
    !isNullableString(description) ||
    !isString(operatorId) ||
    !isString(operatorName) ||
    !isString(createdAt) ||
    !isNullableString(correctsMovementId) ||
    !isNullableString(cancelledById) ||
    !isNullableString(cancelledAt) ||
    !isNullableString(correctedCreatedAt)
  ) {
    return null;
  }
  return {
    id,
    operationId,
    customerId,
    kind,
    amountCents,
    points,
    centsPerPoint,
    rewardId,
    description,
    operatorId,
    operatorName,
    createdAt,
    correctsMovementId,
    cancelledById,
    cancelledAt,
    correctedKind,
    correctedCreatedAt,
  };
}

/** Maps an `app.ledger_result`, or null when its shape is unexpected. */
function toResult(data: unknown): LedgerResult | null {
  const result = record(data);
  if (!result) return null;
  const movement = toMovement(result.movement);
  const { balance } = result;
  if (!movement || !isInteger(balance)) return null;
  return { movement, balance };
}

/** The error to reject with, or null when the answer carries data. */
function failureOf(answer: Answer): Error | null {
  const { error } = answer;
  const status = answer.status ?? 0;
  if (!error) return null;
  // supabase-js answers a failed fetch with status 0 instead of throwing.
  if (status === 0) return new LedgerError('network');
  // A missing grant (42501 "permission denied for function") is the server's fault, not a refusal.
  const fault = serverFaultFor(error, status);
  if (fault) return new ServerFaultError(fault);
  const code = error.code ?? '';
  return new LedgerError(
    Object.hasOwn(LEDGER_ERRCODES, code) ? (LEDGER_ERRCODES[code] ?? 'unknown') : 'unknown',
  );
}

/**
 * Sends a request and waits at most 8 s for its answer: past that, or when fetch throws, it rejects
 * with `network` and aborts the request. The write may still have reached the server: the screen
 * keeps the operation id, so a resend answers the first result.
 */
async function send(request: () => Request): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LedgerError('network'));
    }, REQUEST_TIMEOUT_MS);
  });
  let answer: Answer;
  try {
    answer = await Promise.race([request().abortSignal(controller.signal), timeout]);
  } catch {
    throw new LedgerError('network');
  } finally {
    clearTimeout(timer);
  }
  const failure = failureOf(answer);
  if (failure) throw failure;
  return answer.data;
}

async function write(fn: string, args: Record<string, unknown>): Promise<LedgerResult> {
  const data = await send(() => getSupabase().schema('app').rpc(fn, args));
  const result = toResult(data);
  if (!result) throw new LedgerError('unknown');
  return result;
}

/** The PostgREST filter for "strictly older than the cursor", or null when the cursor is malformed. */
function olderThan({ createdAt, id }: MovementCursor): string | null {
  if (!TIMESTAMP.test(createdAt) || !UUID.test(id)) return null;
  return `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id})`;
}

export const supabaseLedgerService: LedgerService = {
  recordPurchase({ operationId, customerId, amountCents }) {
    return write('record_purchase', {
      p_operation_id: operationId,
      p_customer_id: customerId,
      p_amount_cents: amountCents,
    });
  },

  redeemReward({ operationId, customerId, rewardId }) {
    return write('redeem_reward', {
      p_operation_id: operationId,
      p_customer_id: customerId,
      p_reward_id: rewardId,
    });
  },

  redeemFreeReward({ operationId, customerId, description, points }) {
    return write('redeem_free_reward', {
      p_operation_id: operationId,
      p_customer_id: customerId,
      p_description: description,
      p_points: points,
    });
  },

  cancelMovement({ operationId, movementId }) {
    return write('cancel_movement', { p_operation_id: operationId, p_movement_id: movementId });
  },

  async listMovements(customerId, options = {}) {
    const limit = options.limit ?? PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE)
      throw new LedgerError('invalid');
    const after = options.before ? olderThan(options.before) : null;
    if (options.before && after === null) throw new LedgerError('invalid');
    const data = await send(() => {
      let query = getSupabase()
        .schema('app')
        .from('movement_history')
        .select(COLUMNS)
        .eq('customer_id', customerId);
      if (after !== null) query = query.or(after);
      return query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
    });
    if (!Array.isArray(data)) throw new LedgerError('unknown');
    const rows: unknown[] = data;
    const movements = rows.map(toMovement);
    if (movements.some((movement) => movement === null)) throw new LedgerError('unknown');
    return movements.filter((movement) => movement !== null);
  },
};
