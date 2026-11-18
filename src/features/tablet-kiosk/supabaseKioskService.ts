import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import type { Operator, Role } from '../identity/types';
import { KioskError } from './types';
import type { Cashier, KioskErrorKind, KioskService, SetPinResult, UnlockResult } from './types';

// The only module that calls the kiosk RPCs (app.list_cashiers, app.unlock_cashier,
// app.end_cashier_turn, app.set_my_pin). The PIN goes into the request body and nowhere else: errors
// are built from the server's code alone, never from its text, and nothing here logs.

/** A request without an answer within 8 s counts as no connection, like the ledger's. */
export const KIOSK_REQUEST_TIMEOUT_MS = 8000;

/**
 * The SQLSTATEs the kiosk RPCs raise (SPEC-tablet-kiosk, "Modello dati") and their translation.
 * `scripts/kioskBoundary.test.ts` checks the list against the migration.
 */
export const KIOSK_ERRCODES: Readonly<Record<string, KioskErrorKind>> = {
  '42501': 'forbidden',
  '22023': 'invalid',
};

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
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);
const isRole = (value: unknown): value is Role => value === 'admin' || value === 'operator';

/** A timestamptz as PostgREST writes it, microseconds included. */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/;

/** The instant of a timestamptz, or null when it is not one. Microseconds are dropped. */
function toDate(value: unknown): Date | null {
  if (!isString(value)) return null;
  const parts = TIMESTAMP.exec(value);
  if (!parts) return null;
  const [, seconds = '', fraction = '', zone = ''] = parts;
  const date = new Date(`${seconds}${fraction.slice(0, 4)}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Maps a row of `app.list_cashiers`, or null when its shape is unexpected. */
function toCashier(data: unknown): Cashier | null {
  const row = record(data);
  if (!row) return null;
  const { id, name, role, has_pin: hasPin } = row;
  if (!isString(id) || !isString(name) || !isRole(role) || typeof hasPin !== 'boolean') return null;
  return { id, name, role, hasPin };
}

function toOperator(data: unknown): Operator | null {
  const row = record(data);
  if (!row) return null;
  const { id, name, role } = row;
  if (!isString(id) || !isString(name) || !isRole(role)) return null;
  return { id, name, role };
}

/** Maps the jsonb answer of `app.unlock_cashier`, or null when its shape is unexpected. */
function toUnlockResult(data: unknown): UnlockResult | null {
  const result = record(data);
  if (!result) return null;
  switch (result.status) {
    case 'ok': {
      const cashier = toOperator(result.cashier);
      const turnExpiresAt = toDate(result.turn_expires_at);
      return cashier && turnExpiresAt ? { status: 'ok', cashier, turnExpiresAt } : null;
    }
    case 'wrong_pin': {
      const { attempts_left: attemptsLeft } = result;
      return isInteger(attemptsLeft) ? { status: 'wrong-pin', attemptsLeft } : null;
    }
    case 'locked': {
      // The seconds left are the server's, passed on as they arrive: never the tablet's clock.
      const { lock_seconds_left: lockSecondsLeft } = result;
      return isInteger(lockSecondsLeft) ? { status: 'locked', lockSecondsLeft } : null;
    }
    case 'no_pin':
      return { status: 'no-pin' };
    default:
      return null;
  }
}

/** The error to reject with, or null when the answer carries data. */
function failureOf(answer: Answer): Error | null {
  const { error } = answer;
  const status = answer.status ?? 0;
  if (!error) return null;
  // supabase-js answers a failed fetch with status 0 instead of throwing.
  if (status === 0) return new KioskError('network');
  // A missing grant (42501 "permission denied for function") is the server's fault, not a refusal.
  const fault = serverFaultFor(error, status);
  if (fault) return new ServerFaultError(fault);
  const code = error.code ?? '';
  return new KioskError(
    Object.hasOwn(KIOSK_ERRCODES, code) ? (KIOSK_ERRCODES[code] ?? 'unknown') : 'unknown',
  );
}

/**
 * Calls one kiosk RPC and returns its data. A thrown fetch (`TypeError`) or no answer within the
 * timeout rejects with `network` and aborts the request.
 */
async function call(
  fn: 'list_cashiers' | 'unlock_cashier' | 'end_cashier_turn' | 'set_my_pin',
  args?: Record<string, unknown>,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new KioskError('network'));
    }, KIOSK_REQUEST_TIMEOUT_MS);
  });
  let answer: Answer;
  try {
    const client = getSupabase().schema('app');
    const request: Request = args === undefined ? client.rpc(fn) : client.rpc(fn, args);
    answer = await Promise.race([request.abortSignal(controller.signal), timeout]);
  } catch {
    throw new KioskError('network');
  } finally {
    clearTimeout(timer);
  }
  const failure = failureOf(answer);
  if (failure) throw failure;
  return answer.data;
}

const isNetwork = (error: unknown): boolean =>
  error instanceof KioskError && error.kind === 'network';

export const supabaseKioskService: KioskService = {
  async listCashiers() {
    const data = await call('list_cashiers');
    if (!Array.isArray(data)) throw new KioskError('unknown');
    const rows: unknown[] = data;
    const cashiers = rows.map(toCashier);
    if (cashiers.some((cashier) => cashier === null)) throw new KioskError('unknown');
    return cashiers.filter((cashier) => cashier !== null);
  },

  async unlock(operatorId, pin) {
    let data: unknown;
    try {
      data = await call('unlock_cashier', { p_operator_id: operatorId, p_pin: pin });
    } catch (error) {
      if (isNetwork(error)) return { status: 'network' };
      throw error;
    }
    const result = toUnlockResult(data);
    if (!result) throw new KioskError('unknown');
    return result;
  },

  async endTurn() {
    await call('end_cashier_turn');
  },

  async setMyPin(pin): Promise<SetPinResult> {
    try {
      await call('set_my_pin', { p_pin: pin });
    } catch (error) {
      if (isNetwork(error)) return { status: 'network' };
      throw error;
    }
    return { status: 'ok' };
  },
};
