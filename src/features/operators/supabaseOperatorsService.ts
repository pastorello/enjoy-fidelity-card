import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { ServerFaultError, serverFaultFor } from '../../lib/serverFault';
import { getSupabase } from '../../lib/supabase';
import type { Role } from '../identity/types';
import type {
  CancelInviteResult,
  CommonFailure,
  InviteResult,
  ListOperatorsResult,
  Operator,
  OperatorBrief,
  OperatorChangeResult,
  OperatorStatus,
  OperatorsService,
  PinRefusal,
  ResendResult,
} from './types';

// The only module that calls the operators RPCs (app.list_operators, app.set_operator_role,
// app.set_operator_active and, with the cashier's PIN on the till tablet, their _with_pin versions)
// and the operator-invites Edge Function (scripts/operatorsBoundary.test.ts). The PIN goes into the
// request and nowhere else.
// The secret key never comes near the app: the function holds it, and checks the caller through
// the RPCs. Results are built from codes alone, never from the server's text, and nothing here logs:
// an email goes into the request body and nowhere else.

/** An RPC without an answer within 8 s counts as no connection, like the other modules. */
export const OPERATORS_REQUEST_TIMEOUT_MS = 8000;

/**
 * The function waits for Auth, which sends the email: longer than an RPC. No answer in time counts
 * as no connection; retrying an invite with the same `operation_id` sends one email at most.
 */
export const OPERATORS_FUNCTION_TIMEOUT_MS = 20_000;

/** A refusal of the operators RPCs, before it is narrowed to the result of one call. */
type RpcRefusal =
  | 'last-admin'
  | 'self'
  | 'no-account'
  | 'not-found'
  | 'not-invited'
  | 'admin-from-device'
  | 'forbidden'
  | 'unknown';

/**
 * The SQLSTATEs the operators RPCs raise (SPEC-operators, "Modello dati") and their translation.
 * 22023 (an input the server refused) is a bug of the client: worded as any other failure. EO004 is
 * raised by the begin steps the function calls; `scripts/operatorsBoundary.test.ts` checks the list
 * against the migration.
 */
export const OPERATORS_ERRCODES: Readonly<Record<string, RpcRefusal>> = {
  '42501': 'forbidden',
  '22023': 'unknown',
  P0002: 'not-found',
  EO001: 'last-admin',
  EO002: 'self',
  EO003: 'no-account',
  EO004: 'not-invited',
  EO005: 'admin-from-device',
};

/** The parts of a supabase-js answer this module looks at. */
type Answer = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  status?: number;
};

/** A supabase-js builder: awaitable and cancellable. */
type Request = PromiseLike<Answer> & { abortSignal(signal: AbortSignal): PromiseLike<Answer> };

const STATUSES: readonly OperatorStatus[] = ['active', 'invited', 'deactivated', 'removed'];

function record(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  return { ...data };
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isRole = (value: unknown): value is Role => value === 'admin' || value === 'operator';
const isStatus = (value: unknown): value is OperatorStatus =>
  STATUSES.some((status) => status === value);

/** Maps a row of `app.list_operators` (and of the set_* RPCs), or null when unexpected. */
function toOperator(data: unknown): Operator | null {
  const row = record(data);
  if (!row) return null;
  const { id, name, role, status, email, has_pin: hasPin, is_me: isMe } = row;
  if (!isString(id) || !isString(name) || !isRole(role) || !isStatus(status)) return null;
  if (email !== null && !isString(email)) return null;
  if (typeof hasPin !== 'boolean' || typeof isMe !== 'boolean') return null;
  return { id, name, role, status, email, hasPin, isMe };
}

function toBrief(data: unknown): OperatorBrief | null {
  const row = record(data);
  if (!row) return null;
  const { id, name, role } = row;
  if (!isString(id) || !isString(name) || !isRole(role)) return null;
  return { id, name, role };
}

type Settled = { data: unknown } | { failure: RpcRefusal | 'network' };

/**
 * Calls one operators RPC. No answer (a thrown fetch, status 0, the timeout) settles as `network`;
 * a server fault rejects, read before any code (a missing grant is a 42501 too).
 */
type Rpc =
  | 'list_operators'
  | 'set_operator_role'
  | 'set_operator_active'
  | 'set_operator_role_with_pin'
  | 'set_operator_active_with_pin';

async function call(fn: Rpc, args?: Record<string, unknown>): Promise<Settled> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, OPERATORS_REQUEST_TIMEOUT_MS);
  });
  let answer: Answer | null;
  try {
    const client = getSupabase().schema('app');
    const request: Request = args === undefined ? client.rpc(fn) : client.rpc(fn, args);
    answer = await Promise.race([request.abortSignal(controller.signal), timeout]);
  } catch {
    return { failure: 'network' };
  } finally {
    clearTimeout(timer);
  }
  if (answer === null) return { failure: 'network' };
  const { error } = answer;
  const status = answer.status ?? 0;
  if (!error) return { data: answer.data };
  // supabase-js answers a failed fetch with status 0 instead of throwing.
  if (status === 0) return { failure: 'network' };
  const fault = serverFaultFor(error, status);
  if (fault) throw new ServerFaultError(fault);
  const code = error.code ?? '';
  return {
    failure: Object.hasOwn(OPERATORS_ERRCODES, code)
      ? (OPERATORS_ERRCODES[code] ?? 'unknown')
      : 'unknown',
  };
}

/** The single row the set_* RPCs return, as a result. */
async function change(
  fn: 'set_operator_role' | 'set_operator_active',
  args: Record<string, unknown>,
): Promise<OperatorChangeResult> {
  const settled = await call(fn, args);
  if ('failure' in settled) {
    // EO004 belongs to the invites, never to these RPCs.
    return { status: settled.failure === 'not-invited' ? 'unknown' : settled.failure };
  }
  if (!Array.isArray(settled.data) || settled.data.length !== 1) return { status: 'unknown' };
  const rows: unknown[] = settled.data;
  const operator = toOperator(rows[0]);
  return operator ? { status: 'ok', operator } : { status: 'unknown' };
}

/** A whole count of the server (attempts, seconds), or null when it is anything else. */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A refused PIN: `wrong_pin` / `locked` of the RPCs, `wrong_pin` / `pin_locked` of the function. */
function pinRefusal(
  status: unknown,
  fields: Record<string, unknown>,
): PinRefusal | { status: 'unknown' } {
  if (status === 'wrong_pin') {
    const attemptsLeft = count(fields.attempts_left);
    return attemptsLeft === null ? { status: 'unknown' } : { status: 'wrong-pin', attemptsLeft };
  }
  const lockSecondsLeft = count(fields.lock_seconds_left);
  return lockSecondsLeft === null
    ? { status: 'unknown' }
    : { status: 'pin-locked', lockSecondsLeft };
}

/**
 * The same change with the cashier's PIN (the _with_pin RPCs, jsonb): `ok` with the profile, or
 * the PIN refused (`wrong_pin`, `locked`), which the server keeps counted.
 */
async function changeWithPin(
  fn: 'set_operator_role_with_pin' | 'set_operator_active_with_pin',
  args: Record<string, unknown>,
): Promise<OperatorChangeResult> {
  const settled = await call(fn, args);
  if ('failure' in settled) {
    return { status: settled.failure === 'not-invited' ? 'unknown' : settled.failure };
  }
  const answer = record(settled.data);
  if (!answer) return { status: 'unknown' };
  if (answer.status === 'ok') {
    const operator = toOperator(answer.operator);
    return operator ? { status: 'ok', operator } : { status: 'unknown' };
  }
  if (answer.status === 'wrong_pin' || answer.status === 'locked') {
    return pinRefusal(answer.status, answer);
  }
  return { status: 'unknown' };
}

/** An answer of operator-invites: its body on a 2xx, its error code otherwise. */
type FunctionAnswer =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: string; body: Record<string, unknown> }
  | { ok: false; code: 'network' };

/** The function's body of a non-2xx answer; an empty record when it is not JSON. */
async function errorBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json();
    return record(parsed) ?? {};
  } catch {
    return {};
  }
}

/**
 * Posts one action to operator-invites. Server faults reject: the function missing (404, not
 * deployed), an origin outside `APP_ORIGINS` (`forbidden_origin`), the platform down (503, relay).
 */
async function invoke(body: Record<string, unknown>): Promise<FunctionAnswer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, OPERATORS_FUNCTION_TIMEOUT_MS);
  });
  let answer: { data: unknown; error: unknown } | null;
  try {
    const request = getSupabase().functions.invoke('operator-invites', {
      body,
      signal: controller.signal,
    });
    answer = await Promise.race([request, timeout]);
  } catch {
    return { ok: false, code: 'network' };
  } finally {
    clearTimeout(timer);
  }
  if (answer === null) return { ok: false, code: 'network' };
  const { data, error } = answer;
  if (!error) {
    const fields = record(data);
    return fields ? { ok: true, body: fields } : { ok: false, code: 'unknown', body: {} };
  }
  if (error instanceof FunctionsFetchError) return { ok: false, code: 'network' };
  if (error instanceof FunctionsRelayError) throw new ServerFaultError('unavailable');
  if (!(error instanceof FunctionsHttpError) || !(error.context instanceof Response)) {
    return { ok: false, code: 'unknown', body: {} };
  }
  const response = error.context;
  if (response.status === 503) throw new ServerFaultError('unavailable');
  if (response.status === 404) throw new ServerFaultError('misconfigured');
  const fields = await errorBody(response);
  const code = isString(fields.error) ? fields.error : 'unknown';
  if (code === 'forbidden_origin') throw new ServerFaultError('misconfigured');
  return { ok: false, code, body: fields };
}

/** The failures every action shares: no answer, the role lost; anything else is unknown. */
function common(code: string): CommonFailure {
  if (code === 'network') return 'network';
  if (code === 'forbidden') return 'forbidden';
  return 'unknown';
}

export const supabaseOperatorsService: OperatorsService = {
  async list(): Promise<ListOperatorsResult> {
    const settled = await call('list_operators');
    if ('failure' in settled) return { status: common(settled.failure) };
    if (!Array.isArray(settled.data)) return { status: 'unknown' };
    const rows: unknown[] = settled.data;
    const operators = rows.map(toOperator);
    if (operators.some((operator) => operator === null)) return { status: 'unknown' };
    return { status: 'ok', operators: operators.filter((operator) => operator !== null) };
  },

  setRole(operatorId, role, pin) {
    const args = { p_operator_id: operatorId, p_role: role };
    return pin === undefined
      ? change('set_operator_role', args)
      : changeWithPin('set_operator_role_with_pin', { ...args, p_pin: pin });
  },

  setActive(operatorId, active, pin) {
    const args = { p_operator_id: operatorId, p_active: active };
    return pin === undefined
      ? change('set_operator_active', args)
      : changeWithPin('set_operator_active_with_pin', { ...args, p_pin: pin });
  },

  async invite({ operationId, name, email, role }, pin): Promise<InviteResult> {
    const answer = await invoke({
      action: 'invite',
      operation_id: operationId,
      name,
      email,
      role,
      ...(pin === undefined ? {} : { pin }),
    });
    if (answer.ok) {
      const operator = answer.body.status === 'invited' ? toBrief(answer.body.operator) : null;
      return operator ? { status: 'invited', operator } : { status: 'unknown' };
    }
    switch (answer.code) {
      case 'in_progress':
        return { status: 'in-progress' };
      case 'name_taken':
        return { status: 'name-taken' };
      case 'email_taken':
        return { status: 'email-taken', deactivated: answer.body.deactivated === true };
      case 'email_is_device':
        return { status: 'email-is-device' };
      case 'admin_from_device':
        return { status: 'admin-from-device' };
      case 'rate_limited':
        return { status: 'rate-limited' };
      case 'wrong_pin':
      case 'pin_locked':
        return pinRefusal(answer.code, answer.body);
      default:
        return { status: common(answer.code) };
    }
  },

  async resendInvite(operatorId): Promise<ResendResult> {
    const answer = await invoke({ action: 'resend', operator_id: operatorId });
    if (answer.ok)
      return answer.body.status === 'resent' ? { status: 'resent' } : { status: 'unknown' };
    switch (answer.code) {
      case 'not_invited':
        return { status: 'not-invited' };
      case 'self':
        return { status: 'self' };
      case 'rate_limited':
        return { status: 'rate-limited' };
      default:
        return { status: common(answer.code) };
    }
  },

  async cancelInvite(operatorId): Promise<CancelInviteResult> {
    const answer = await invoke({ action: 'cancel', operator_id: operatorId });
    if (answer.ok) {
      return answer.body.status === 'cancelled' ? { status: 'cancelled' } : { status: 'unknown' };
    }
    switch (answer.code) {
      case 'not_invited':
        return { status: 'not-invited' };
      case 'self':
        return { status: 'self' };
      default:
        return { status: common(answer.code) };
    }
  },
};
