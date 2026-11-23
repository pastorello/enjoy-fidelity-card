import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import {
  OPERATORS_ERRCODES,
  OPERATORS_FUNCTION_TIMEOUT_MS,
  OPERATORS_REQUEST_TIMEOUT_MS,
  supabaseOperatorsService as service,
} from './supabaseOperatorsService';

type Answer = { data: unknown; error: unknown; status: number };
type Invoked = { data: unknown; error: unknown };
type InvokeOptions = { body?: unknown; signal?: AbortSignal };

const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: unknown) => unknown>(),
  invoke: vi.fn<(name: string, options?: InvokeOptions) => Promise<unknown>>(),
  signals: [] as AbortSignal[],
  answer: (): Promise<unknown> => Promise.resolve(null),
}));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ schema: db.schema, functions: { invoke: db.invoke } }),
}));

/** A supabase-js RPC builder: cancellable with `abortSignal()` and awaitable. */
function builder(): Promise<unknown> {
  const pending = db.answer();
  pending.catch(() => undefined);
  const query = Object.assign(pending, {
    abortSignal: (signal: AbortSignal) => {
      db.signals.push(signal);
      return query;
    },
  });
  return query;
}

function answer(value: Answer | Error | 'never') {
  db.answer = () => {
    if (value === 'never') return new Promise<never>(() => undefined);
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
}

const ID = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b';
const OPERATION = '6f1c2a5e-8b3d-4c7a-9e21-0d4b5f6a7c8e';

const ROW = {
  id: ID,
  name: 'Ruolo Prova',
  role: 'operator',
  status: 'active',
  email: 'ruolo@example.com',
  has_pin: true,
  is_me: false,
};
const OPERATOR = {
  id: ID,
  name: 'Ruolo Prova',
  role: 'operator',
  status: 'active',
  email: 'ruolo@example.com',
  hasPin: true,
  isMe: false,
};

const ok = (data: unknown): Answer => ({ data, error: null, status: 200 });
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

/** What `functions.invoke` resolves with for a non-2xx answer of the function. */
function httpError(status: number, body: unknown): Invoked {
  const response = new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  return { data: null, error: new FunctionsHttpError(response) };
}
const invoked = (data: unknown): Invoked => ({ data, error: null });
/** Every request is cancellable: the service passes its own AbortSignal. */
const anySignal: unknown = expect.any(AbortSignal);

beforeEach(() => {
  vi.resetAllMocks();
  db.signals = [];
  db.schema.mockReturnValue({ rpc: db.rpc });
  db.rpc.mockImplementation(() => builder());
});

afterEach(() => {
  vi.useRealTimers();
});

/** The kind of the ServerFaultError the promise rejects with, or null for any other outcome. */
async function faultKind(promise: Promise<unknown>): Promise<string | null> {
  const error = await rejection(promise);
  return error instanceof ServerFaultError ? error.kind : null;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
}

describe('supabaseOperatorsService.list', () => {
  it('calls app.list_operators and maps every row, in the server order', async () => {
    const removed = { ...ROW, id: 'r', name: 'Zeta', status: 'removed', email: null };
    answer(ok([ROW, removed]));
    await expect(service.list()).resolves.toEqual({
      status: 'ok',
      operators: [OPERATOR, { ...OPERATOR, id: 'r', name: 'Zeta', status: 'removed', email: null }],
    });
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.rpc).toHaveBeenCalledWith('list_operators');
  });

  it.each([
    ['status', { ...ROW, status: 'pending' }],
    ['role', { ...ROW, role: 'owner' }],
    ['has_pin', { ...ROW, has_pin: 'yes' }],
    ['email', { ...ROW, email: 3 }],
  ])('answers unknown on a row with a malformed %s', async (_field, row) => {
    answer(ok([row]));
    await expect(service.list()).resolves.toEqual({ status: 'unknown' });
  });

  it('answers unknown when the answer is not a list', async () => {
    answer(ok({ not: 'a list' }));
    await expect(service.list()).resolves.toEqual({ status: 'unknown' });
  });

  it('answers forbidden on the 42501 of a person who is no admin', async () => {
    answer(pgError('42501', 403, 'Only an admin can list the operators'));
    await expect(service.list()).resolves.toEqual({ status: 'forbidden' });
  });

  it('answers network without a response, on a thrown fetch and past the timeout', async () => {
    answer(noResponse);
    await expect(service.list()).resolves.toEqual({ status: 'network' });
    answer(new TypeError('Failed to fetch'));
    await expect(service.list()).resolves.toEqual({ status: 'network' });

    vi.useFakeTimers();
    answer('never');
    const pending = service.list();
    await vi.advanceTimersByTimeAsync(OPERATORS_REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ status: 'network' });
    expect(db.signals.at(-1)?.aborted).toBe(true);
  });

  it('rejects with a server fault before reading the code (missing grant, schema, 503)', async () => {
    answer(pgError('42501', 403, 'permission denied for function list_operators'));
    expect(await faultKind(service.list())).toBe('misconfigured');

    answer(pgError('PGRST202', 404));
    expect(await faultKind(service.list())).toBe('misconfigured');

    answer(pgError('PGRST002', 503));
    expect(await faultKind(service.list())).toBe('unavailable');
  });
});

describe('supabaseOperatorsService.setRole and setActive', () => {
  it('sends the target and the role to app.set_operator_role and maps the row', async () => {
    answer(ok([{ ...ROW, role: 'admin' }]));
    await expect(service.setRole(ID, 'admin')).resolves.toEqual({
      status: 'ok',
      operator: { ...OPERATOR, role: 'admin' },
    });
    expect(db.rpc).toHaveBeenCalledWith('set_operator_role', {
      p_operator_id: ID,
      p_role: 'admin',
    });
  });

  it('sends the target and the state to app.set_operator_active and maps the row', async () => {
    answer(ok([{ ...ROW, status: 'deactivated' }]));
    await expect(service.setActive(ID, false)).resolves.toEqual({
      status: 'ok',
      operator: { ...OPERATOR, status: 'deactivated' },
    });
    expect(db.rpc).toHaveBeenCalledWith('set_operator_active', {
      p_operator_id: ID,
      p_active: false,
    });
  });

  it.each([
    ['EO001', 400, 'last-admin'],
    ['EO002', 400, 'self'],
    ['EO003', 400, 'no-account'],
    ['P0002', 404, 'not-found'],
    ['EO005', 400, 'admin-from-device'],
    ['42501', 403, 'forbidden'],
    ['22023', 400, 'unknown'],
    ['XX000', 500, 'unknown'],
  ])('maps %s to %s', async (code, status, expected) => {
    answer(pgError(code, status));
    await expect(service.setRole(ID, 'operator')).resolves.toEqual({ status: expected });
    await expect(service.setActive(ID, true)).resolves.toEqual({ status: expected });
  });

  it('answers network without a response and unknown on a malformed answer', async () => {
    answer(noResponse);
    await expect(service.setActive(ID, true)).resolves.toEqual({ status: 'network' });
    answer(ok([]));
    await expect(service.setActive(ID, true)).resolves.toEqual({ status: 'unknown' });
    answer(ok([ROW, ROW]));
    await expect(service.setRole(ID, 'admin')).resolves.toEqual({ status: 'unknown' });
  });

  it('rejects with a server fault on a missing grant', async () => {
    answer(pgError('42501', 403, 'permission denied for function set_operator_active'));
    expect(await faultKind(service.setActive(ID, false))).toBe('misconfigured');
  });
});

describe('supabaseOperatorsService.setRole and setActive with the cashier PIN (tablet)', () => {
  it('sends the PIN to app.set_operator_role_with_pin and maps the profile of its answer', async () => {
    answer(ok({ status: 'ok', operator: { ...ROW, role: 'admin' } }));
    await expect(service.setRole(ID, 'admin', '2468')).resolves.toEqual({
      status: 'ok',
      operator: { ...OPERATOR, role: 'admin' },
    });
    expect(db.rpc).toHaveBeenCalledWith('set_operator_role_with_pin', {
      p_operator_id: ID,
      p_role: 'admin',
      p_pin: '2468',
    });
  });

  it('sends the PIN to app.set_operator_active_with_pin', async () => {
    answer(ok({ status: 'ok', operator: ROW }));
    await expect(service.setActive(ID, true, '2468')).resolves.toEqual({
      status: 'ok',
      operator: OPERATOR,
    });
    expect(db.rpc).toHaveBeenCalledWith('set_operator_active_with_pin', {
      p_operator_id: ID,
      p_active: true,
      p_pin: '2468',
    });
  });

  it('maps a wrong PIN and the lock of the till', async () => {
    answer(ok({ status: 'wrong_pin', attempts_left: 3 }));
    await expect(service.setRole(ID, 'admin', '0000')).resolves.toEqual({
      status: 'wrong-pin',
      attemptsLeft: 3,
    });
    answer(ok({ status: 'locked', lock_seconds_left: 241 }));
    await expect(service.setActive(ID, true, '0000')).resolves.toEqual({
      status: 'pin-locked',
      lockSecondsLeft: 241,
    });
  });

  it.each([
    ['an unknown status', { status: 'maybe' }],
    ['wrong_pin without a count', { status: 'wrong_pin' }],
    ['locked with a negative count', { status: 'locked', lock_seconds_left: -1 }],
    ['ok without a profile', { status: 'ok' }],
    ['a list of rows', [ROW]],
  ])('answers unknown on %s', async (_label, data) => {
    answer(ok(data));
    await expect(service.setRole(ID, 'admin', '2468')).resolves.toEqual({ status: 'unknown' });
  });

  it('maps the refusals of the RPC as without the PIN', async () => {
    answer(pgError('EO005', 400));
    await expect(service.setRole(ID, 'admin', '2468')).resolves.toEqual({
      status: 'admin-from-device',
    });
    answer(pgError('42501', 403));
    await expect(service.setActive(ID, true, '2468')).resolves.toEqual({ status: 'forbidden' });
  });
});

describe('supabaseOperatorsService.invite', () => {
  const INPUT = {
    operationId: OPERATION,
    name: 'Invito Prova',
    email: 'invito@example.com',
    role: 'operator' as const,
  };

  it('posts the invite to operator-invites and maps the profile', async () => {
    db.invoke.mockResolvedValue(
      invoked({
        status: 'invited',
        operator: { id: ID, name: 'Invito Prova', role: 'operator' },
      }),
    );
    await expect(service.invite(INPUT)).resolves.toEqual({
      status: 'invited',
      operator: { id: ID, name: 'Invito Prova', role: 'operator' },
    });
    expect(db.invoke).toHaveBeenCalledWith('operator-invites', {
      body: {
        action: 'invite',
        operation_id: OPERATION,
        name: 'Invito Prova',
        email: 'invito@example.com',
        role: 'operator',
      },
      signal: anySignal,
    });
  });

  it.each([
    [409, { error: 'in_progress' }, { status: 'in-progress' }],
    [409, { error: 'name_taken' }, { status: 'name-taken' }],
    [
      409,
      { error: 'email_taken', deactivated: false },
      { status: 'email-taken', deactivated: false },
    ],
    [
      409,
      { error: 'email_taken', deactivated: true },
      { status: 'email-taken', deactivated: true },
    ],
    [409, { error: 'email_taken' }, { status: 'email-taken', deactivated: false }],
    [409, { error: 'email_is_device' }, { status: 'email-is-device' }],
    [409, { error: 'not_invited' }, { status: 'unknown' }],
    [403, { error: 'forbidden' }, { status: 'forbidden' }],
    [403, { error: 'self' }, { status: 'unknown' }],
    [403, { error: 'admin_from_device' }, { status: 'admin-from-device' }],
    [401, { error: 'unauthorized' }, { status: 'unknown' }],
    [400, { error: 'invalid_input' }, { status: 'unknown' }],
    [429, { error: 'rate_limited' }, { status: 'rate-limited' }],
    [502, { error: 'upstream' }, { status: 'unknown' }],
    [500, 'not json', { status: 'unknown' }],
    [409, { error: 'something_new' }, { status: 'unknown' }],
  ])('maps HTTP %i %j', async (status, body, expected) => {
    db.invoke.mockResolvedValue(httpError(status, body));
    await expect(service.invite(INPUT)).resolves.toEqual(expected);
  });

  it('adds the cashier PIN of the tablet to the body only when there is one', async () => {
    db.invoke.mockResolvedValue(
      invoked({ status: 'invited', operator: { id: ID, name: 'Invito Prova', role: 'admin' } }),
    );
    await service.invite({ ...INPUT, role: 'admin' }, '2468');
    expect(db.invoke).toHaveBeenCalledWith('operator-invites', {
      body: {
        action: 'invite',
        operation_id: OPERATION,
        name: 'Invito Prova',
        email: 'invito@example.com',
        role: 'admin',
        pin: '2468',
      },
      signal: anySignal,
    });
  });

  it.each([
    [
      { error: 'wrong_pin', attempts_left: 2 },
      { status: 'wrong-pin', attemptsLeft: 2 },
    ],
    [
      { error: 'pin_locked', lock_seconds_left: 300 },
      { status: 'pin-locked', lockSecondsLeft: 300 },
    ],
    [{ error: 'wrong_pin' }, { status: 'unknown' }],
    [{ error: 'pin_locked', lock_seconds_left: 'soon' }, { status: 'unknown' }],
  ])('maps 403 %j for the PIN of the tablet', async (body, expected) => {
    db.invoke.mockResolvedValue(httpError(403, body));
    await expect(service.invite({ ...INPUT, role: 'admin' }, '0000')).resolves.toEqual(expected);
  });

  it('answers network when the request never reached the function', async () => {
    db.invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('x')) });
    await expect(service.invite(INPUT)).resolves.toEqual({ status: 'network' });
    db.invoke.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(service.invite(INPUT)).resolves.toEqual({ status: 'network' });
  });

  it('answers network and aborts the request past the timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    db.invoke.mockImplementation((_name, options) => {
      signal = options?.signal;
      return new Promise<never>(() => undefined);
    });
    const pending = service.invite(INPUT);
    await vi.advanceTimersByTimeAsync(OPERATORS_FUNCTION_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ status: 'network' });
    expect(signal?.aborted).toBe(true);
  });

  it('answers unknown on a 200 it does not understand', async () => {
    db.invoke.mockResolvedValue(invoked({ status: 'invited', operator: { id: ID } }));
    await expect(service.invite(INPUT)).resolves.toEqual({ status: 'unknown' });
    db.invoke.mockResolvedValue(invoked('ok'));
    await expect(service.invite(INPUT)).resolves.toEqual({ status: 'unknown' });
  });

  it('rejects with a server fault when the function is missing, refuses the origin or is down', async () => {
    db.invoke.mockResolvedValue(httpError(404, { code: 'NOT_FOUND' }));
    expect(await faultKind(service.invite(INPUT))).toBe('misconfigured');

    db.invoke.mockResolvedValue(httpError(403, { error: 'forbidden_origin' }));
    expect(await faultKind(service.invite(INPUT))).toBe('misconfigured');

    db.invoke.mockResolvedValue(httpError(503, {}));
    expect(await faultKind(service.invite(INPUT))).toBe('unavailable');

    db.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsRelayError(new Response('', { status: 502 })),
    });
    expect(await faultKind(service.invite(INPUT))).toBe('unavailable');
  });
});

describe('supabaseOperatorsService.resendInvite and cancelInvite', () => {
  it('posts resend with the operator id only and maps resent', async () => {
    db.invoke.mockResolvedValue(invoked({ status: 'resent' }));
    await expect(service.resendInvite(ID)).resolves.toEqual({ status: 'resent' });
    expect(db.invoke).toHaveBeenCalledWith('operator-invites', {
      body: { action: 'resend', operator_id: ID },
      signal: anySignal,
    });
  });

  it('posts cancel with the operator id only and maps cancelled', async () => {
    db.invoke.mockResolvedValue(invoked({ status: 'cancelled' }));
    await expect(service.cancelInvite(ID)).resolves.toEqual({ status: 'cancelled' });
    expect(db.invoke).toHaveBeenCalledWith('operator-invites', {
      body: { action: 'cancel', operator_id: ID },
      signal: anySignal,
    });
  });

  it.each([
    [409, 'not_invited', 'not-invited', 'not-invited'],
    [403, 'self', 'self', 'self'],
    [403, 'forbidden', 'forbidden', 'forbidden'],
    [429, 'rate_limited', 'rate-limited', 'unknown'],
    [403, 'admin_from_device', 'unknown', 'unknown'],
    [409, 'in_progress', 'unknown', 'unknown'],
    [502, 'upstream', 'unknown', 'unknown'],
    [401, 'unauthorized', 'unknown', 'unknown'],
    [400, 'invalid_input', 'unknown', 'unknown'],
  ])('maps HTTP %i %s (resend %s, cancel %s)', async (status, code, resend, cancel) => {
    // A fresh Response for each call: a body is read once.
    db.invoke.mockImplementation(() => Promise.resolve(httpError(status, { error: code })));
    await expect(service.resendInvite(ID)).resolves.toEqual({ status: resend });
    await expect(service.cancelInvite(ID)).resolves.toEqual({ status: cancel });
  });

  it('answers network without an answer and unknown on another 200', async () => {
    db.invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('x')) });
    await expect(service.resendInvite(ID)).resolves.toEqual({ status: 'network' });
    await expect(service.cancelInvite(ID)).resolves.toEqual({ status: 'network' });
    db.invoke.mockResolvedValue(invoked({ status: 'cancelled' }));
    await expect(service.resendInvite(ID)).resolves.toEqual({ status: 'unknown' });
    db.invoke.mockResolvedValue(invoked({ status: 'resent' }));
    await expect(service.cancelInvite(ID)).resolves.toEqual({ status: 'unknown' });
  });
});

describe('OPERATORS_ERRCODES', () => {
  it('translates the codes of the module and the standard ones the RPCs raise', () => {
    expect(OPERATORS_ERRCODES).toEqual({
      '42501': 'forbidden',
      '22023': 'unknown',
      P0002: 'not-found',
      EO001: 'last-admin',
      EO002: 'self',
      EO003: 'no-account',
      EO004: 'not-invited',
      EO005: 'admin-from-device',
    });
  });
});
