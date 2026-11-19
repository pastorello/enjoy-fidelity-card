import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import {
  KIOSK_ERRCODES,
  KIOSK_REQUEST_TIMEOUT_MS,
  supabaseKioskService as service,
} from './supabaseKioskService';
import { KioskError } from './types';
import type { KioskErrorKind } from './types';

type Answer = { data: unknown; error: unknown; status: number };

const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: unknown) => unknown>(),
  signals: [] as AbortSignal[],
  answer: (): Promise<unknown> => Promise.resolve(null),
}));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ schema: db.schema }),
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

const OPERATOR = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b';
const OTHER = '6f1c2a5e-8b3d-4c7a-9e21-0d4b5f6a7c8e';
const PIN = '4821';

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

beforeEach(() => {
  vi.resetAllMocks();
  db.signals = [];
  db.schema.mockReturnValue({ rpc: db.rpc });
  db.rpc.mockImplementation(() => builder());
});

afterEach(() => {
  vi.useRealTimers();
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
}

async function kioskErrorOf(promise: Promise<unknown>): Promise<KioskErrorKind> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(KioskError);
  return error instanceof KioskError ? error.kind : 'unknown';
}

describe('listCashiers', () => {
  it('calls app.list_cashiers and maps every row', async () => {
    answer(
      ok([
        { id: OPERATOR, name: 'Anna Prova', role: 'admin', has_pin: true },
        { id: OTHER, name: 'Bruno Prova', role: 'operator', has_pin: false },
      ]),
    );
    const cashiers = await service.listCashiers();
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.rpc).toHaveBeenCalledWith('list_cashiers');
    expect(cashiers).toEqual([
      { id: OPERATOR, name: 'Anna Prova', role: 'admin', hasPin: true },
      { id: OTHER, name: 'Bruno Prova', role: 'operator', hasPin: false },
    ]);
  });

  it('rejects with unknown on a malformed row', async () => {
    answer(ok([{ id: OPERATOR, name: 'Anna Prova', role: 'owner', has_pin: true }]));
    expect(await kioskErrorOf(service.listCashiers())).toBe('unknown');
    answer(ok([{ id: OPERATOR, name: 'Anna Prova', role: 'admin', has_pin: 'yes' }]));
    expect(await kioskErrorOf(service.listCashiers())).toBe('unknown');
    answer(ok({ id: OPERATOR }));
    expect(await kioskErrorOf(service.listCashiers())).toBe('unknown');
  });

  it('rejects with forbidden when the account is not a device', async () => {
    answer(pgError('42501', 403, 'Only a device account can list the cashiers'));
    expect(await kioskErrorOf(service.listCashiers())).toBe('forbidden');
  });
});

describe('unlock', () => {
  it('sends the operator and the PIN to app.unlock_cashier', async () => {
    answer(ok({ status: 'no_pin' }));
    await service.unlock(OPERATOR, PIN);
    expect(db.rpc).toHaveBeenCalledWith('unlock_cashier', {
      p_operator_id: OPERATOR,
      p_pin: PIN,
    });
  });

  it('maps ok with the cashier and the end of the turn as a Date', async () => {
    answer(
      ok({
        status: 'ok',
        cashier: { id: OPERATOR, name: 'Anna Prova', role: 'operator' },
        turn_expires_at: '2026-11-18T21:30:00.123456+00:00',
      }),
    );
    const result = await service.unlock(OPERATOR, PIN);
    expect(result).toEqual({
      status: 'ok',
      cashier: { id: OPERATOR, name: 'Anna Prova', role: 'operator' },
      turnExpiresAt: new Date('2026-11-18T21:30:00.123Z'),
    });
  });

  it('maps wrong_pin with the attempts left', async () => {
    answer(ok({ status: 'wrong_pin', attempts_left: 3 }));
    expect(await service.unlock(OPERATOR, PIN)).toEqual({ status: 'wrong-pin', attemptsLeft: 3 });
  });

  it('maps locked with the seconds exactly as the server sends them', async () => {
    answer(ok({ status: 'locked', lock_seconds_left: 300 }));
    expect(await service.unlock(OPERATOR, PIN)).toEqual({ status: 'locked', lockSecondsLeft: 300 });
    answer(ok({ status: 'locked', lock_seconds_left: 17 }));
    expect(await service.unlock(OPERATOR, PIN)).toEqual({ status: 'locked', lockSecondsLeft: 17 });
  });

  it('maps no_pin', async () => {
    answer(ok({ status: 'no_pin' }));
    expect(await service.unlock(OPERATOR, PIN)).toEqual({ status: 'no-pin' });
  });

  it('resolves with network when supabase-js answers without a response', async () => {
    answer(noResponse);
    expect(await service.unlock(OPERATOR, PIN)).toEqual({ status: 'network' });
  });

  it('resolves with network when fetch throws a TypeError', async () => {
    answer(new TypeError('Failed to fetch'));
    expect(await service.unlock(OPERATOR, PIN)).toEqual({ status: 'network' });
  });

  it('resolves with network and aborts the request past the timeout', async () => {
    vi.useFakeTimers();
    answer('never');
    const pending = service.unlock(OPERATOR, PIN);
    await vi.advanceTimersByTimeAsync(KIOSK_REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ status: 'network' });
    expect(db.signals[0]?.aborted).toBe(true);
  });

  it('rejects with forbidden when the account is not a device', async () => {
    answer(pgError('42501', 403, 'Only a device account can unlock a cashier'));
    expect(await kioskErrorOf(service.unlock(OPERATOR, PIN))).toBe('forbidden');
  });

  it('rejects with invalid when the PIN is not 4 digits', async () => {
    answer(pgError('22023', 400, 'The PIN must be 4 digits'));
    expect(await kioskErrorOf(service.unlock(OPERATOR, '12'))).toBe('invalid');
  });

  const malformed = [
    { status: 'maybe' },
    { status: 'wrong_pin' },
    { status: 'wrong_pin', attempts_left: 2.5 },
    { status: 'locked', lock_seconds_left: '300' },
    { status: 'ok', cashier: { id: OPERATOR, name: 'Anna Prova', role: 'operator' } },
    {
      status: 'ok',
      cashier: { id: OPERATOR, name: 'Anna Prova', role: 'operator' },
      turn_expires_at: 'tomorrow',
    },
    {
      status: 'ok',
      cashier: { id: OPERATOR, name: 'Anna Prova', role: 'boss' },
      turn_expires_at: '2026-11-18T21:30:00+00:00',
    },
    null,
    [],
  ];

  it.each(malformed)('rejects with unknown on an unexpected answer (%j)', async (data) => {
    answer(ok(data));
    expect(await kioskErrorOf(service.unlock(OPERATOR, PIN))).toBe('unknown');
  });

  it('rejects with unknown on an error code it does not know', async () => {
    answer(pgError('P0001', 400));
    expect(await kioskErrorOf(service.unlock(OPERATOR, PIN))).toBe('unknown');
  });
});

describe('endTurn', () => {
  it('calls app.end_cashier_turn', async () => {
    answer(ok(null));
    await expect(service.endTurn()).resolves.toBeUndefined();
    expect(db.rpc).toHaveBeenCalledWith('end_cashier_turn');
  });

  it('rejects with network when there is no answer', async () => {
    answer(noResponse);
    expect(await kioskErrorOf(service.endTurn())).toBe('network');
    answer(new TypeError('Failed to fetch'));
    expect(await kioskErrorOf(service.endTurn())).toBe('network');
  });

  it('rejects with forbidden when the account is not a device', async () => {
    answer(pgError('42501', 403, 'Only a device account can end a cashier turn'));
    expect(await kioskErrorOf(service.endTurn())).toBe('forbidden');
  });
});

describe('setMyPin', () => {
  it('sends the PIN to app.set_my_pin', async () => {
    answer(ok(null));
    expect(await service.setMyPin(PIN)).toEqual({ status: 'ok' });
    expect(db.rpc).toHaveBeenCalledWith('set_my_pin', { p_pin: PIN });
  });

  it('resolves with network when there is no answer', async () => {
    answer(noResponse);
    expect(await service.setMyPin(PIN)).toEqual({ status: 'network' });
    answer(new TypeError('Failed to fetch'));
    expect(await service.setMyPin(PIN)).toEqual({ status: 'network' });
  });

  it('rejects with forbidden on a device and invalid on a malformed PIN', async () => {
    answer(pgError('42501', 403, 'Only an operator account can set its own PIN'));
    expect(await kioskErrorOf(service.setMyPin(PIN))).toBe('forbidden');
    answer(pgError('22023', 400, 'The PIN must be 4 digits'));
    expect(await kioskErrorOf(service.setMyPin('12a4'))).toBe('invalid');
  });
});

describe('server faults and messages', () => {
  const operations = [
    ['listCashiers', () => service.listCashiers()],
    ['unlock', () => service.unlock(OPERATOR, PIN)],
    ['endTurn', () => service.endTurn()],
    ['setMyPin', () => service.setMyPin(PIN)],
  ] as const;

  const faults = [
    ['missing grant', pgError('42501', 403, 'permission denied for function x'), 'misconfigured'],
    ['missing function', pgError('PGRST202', 404, 'Could not find the function'), 'misconfigured'],
    ['schema cache loading', pgError('PGRST002', 503, 'Could not query the schema'), 'unavailable'],
  ] as const;
  const cases = operations.flatMap(([name, run]) =>
    faults.map(([label, fault, kind]) => [name, label, run, fault, kind] as const),
  );

  it.each(cases)(
    '%s rejects with a ServerFaultError on %s',
    async (_, _label, run, fault, kind) => {
      answer(fault);
      const error = await rejection(run());
      expect(error).toBeInstanceOf(ServerFaultError);
      expect(error instanceof ServerFaultError ? error.kind : null).toBe(kind);
    },
  );

  it.each(operations)('%s never puts the PIN or the server text in an error', async (_, run) => {
    answer(pgError('22023', 400, `The PIN ${PIN} must be 4 digits`));
    const error = await rejection(run());
    expect(String(error)).not.toContain(PIN);
    expect(String(error)).not.toContain('must be');
  });
});

describe('KIOSK_ERRCODES', () => {
  it('translates the codes the kiosk RPCs raise', () => {
    expect(KIOSK_ERRCODES).toEqual({ '42501': 'forbidden', '22023': 'invalid' });
  });
});
