import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerFaultError } from '../../lib/serverFault';
import {
  LEDGER_ERRCODES,
  REQUEST_TIMEOUT_MS,
  supabaseLedgerService as service,
} from './supabaseLedgerService';
import { LedgerError } from './types';
import type { LedgerErrorKind, Movement } from './types';

type Answer = { data: unknown; error: unknown; status: number };

const db = vi.hoisted(() => ({
  schema: vi.fn<(name: string) => unknown>(),
  rpc: vi.fn<(fn: string, args?: unknown) => unknown>(),
  from: vi.fn<(table: string) => unknown>(),
  /** Every builder method the history read called, in order, with its arguments. */
  calls: [] as { method: string; args: unknown[] }[],
  signals: [] as AbortSignal[],
  answer: (): Promise<unknown> => Promise.resolve(null),
}));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({ schema: db.schema }),
}));

/**
 * A supabase-js query builder: chainable, cancellable with `abortSignal()`, and awaitable (here the
 * answer's own promise, with the builder methods attached, like the real thenable builder).
 */
function builder(): Promise<unknown> {
  const pending = db.answer();
  // A test that never sends the request must not leave its rejection unhandled.
  pending.catch(() => undefined);
  const chain =
    (method: string) =>
    (...args: unknown[]): unknown => {
      db.calls.push({ method, args });
      return query;
    };
  const query = Object.assign(pending, {
    select: chain('select'),
    eq: chain('eq'),
    or: chain('or'),
    order: chain('order'),
    limit: chain('limit'),
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

const OPERATION = '7d0e3c1a-2b4f-4a6e-9c8d-1e2f3a4b5c6d';
const CUSTOMER = '3a9f1c2e-5b7d-4e8a-9c0b-1d2e3f4a5b6c';
const MOVEMENT = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const OPERATOR = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b';
const REWARD = '6f1c2a5e-8b3d-4c7a-9e21-0d4b5f6a7c8e';

/** A row of `app.movement_history` as PostgREST returns it. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: MOVEMENT,
  operation_id: OPERATION,
  customer_id: CUSTOMER,
  kind: 'purchase',
  amount_cents: 1250,
  points: 12,
  cents_per_point: 100,
  reward_id: null,
  description: null,
  operator_id: OPERATOR,
  operator_name: 'Operatore di prova',
  created_at: '2026-11-18T09:00:00.123456+00:00',
  corrects_movement_id: null,
  cancelled_by_id: null,
  cancelled_at: null,
  corrected_kind: null,
  corrected_created_at: null,
  ...overrides,
});

const movement: Movement = {
  id: MOVEMENT,
  operationId: OPERATION,
  customerId: CUSTOMER,
  kind: 'purchase',
  amountCents: 1250,
  points: 12,
  centsPerPoint: 100,
  rewardId: null,
  description: null,
  operatorId: OPERATOR,
  operatorName: 'Operatore di prova',
  createdAt: '2026-11-18T09:00:00.123456+00:00',
  correctsMovementId: null,
  cancelledById: null,
  cancelledAt: null,
  correctedKind: null,
  correctedCreatedAt: null,
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

beforeEach(() => {
  vi.resetAllMocks();
  db.calls = [];
  db.signals = [];
  db.schema.mockReturnValue({ rpc: db.rpc, from: db.from });
  db.rpc.mockImplementation(() => builder());
  db.from.mockImplementation(() => builder());
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

async function ledgerErrorOf(promise: Promise<unknown>): Promise<LedgerErrorKind> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(LedgerError);
  return error instanceof LedgerError ? error.kind : 'unknown';
}

const writes = [
  [
    'recordPurchase',
    () =>
      service.recordPurchase({ operationId: OPERATION, customerId: CUSTOMER, amountCents: 1250 }),
  ],
  [
    'redeemReward',
    () => service.redeemReward({ operationId: OPERATION, customerId: CUSTOMER, rewardId: REWARD }),
  ],
  [
    'redeemFreeReward',
    () =>
      service.redeemFreeReward({
        operationId: OPERATION,
        customerId: CUSTOMER,
        description: 'Caffè offerto',
        points: 30,
      }),
  ],
  [
    'cancelMovement',
    () => service.cancelMovement({ operationId: OPERATION, movementId: MOVEMENT }),
  ],
] as const;

const operations = [...writes, ['listMovements', () => service.listMovements(CUSTOMER)]] as const;

describe('writes', () => {
  it('recordPurchase calls app.record_purchase with the operation id and the cents', async () => {
    answer(ok({ movement: row(), balance: 112 }));
    const result = await service.recordPurchase({
      operationId: OPERATION,
      customerId: CUSTOMER,
      amountCents: 1250,
    });
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.rpc).toHaveBeenCalledWith('record_purchase', {
      p_operation_id: OPERATION,
      p_customer_id: CUSTOMER,
      p_amount_cents: 1250,
    });
    expect(result).toEqual({ movement, balance: 112 });
  });

  it('redeemReward calls app.redeem_reward with the reward id only, never its points', async () => {
    answer(
      ok({
        movement: row({
          kind: 'redemption',
          amount_cents: null,
          cents_per_point: null,
          points: -80,
          reward_id: REWARD,
          description: 'Spremuta',
        }),
        balance: 20,
      }),
    );
    const result = await service.redeemReward({
      operationId: OPERATION,
      customerId: CUSTOMER,
      rewardId: REWARD,
    });
    expect(db.rpc).toHaveBeenCalledWith('redeem_reward', {
      p_operation_id: OPERATION,
      p_customer_id: CUSTOMER,
      p_reward_id: REWARD,
    });
    expect(result.movement).toMatchObject({ kind: 'redemption', points: -80, rewardId: REWARD });
    expect(result.movement.description).toBe('Spremuta');
    expect(result.balance).toBe(20);
  });

  it('redeemFreeReward calls app.redeem_free_reward with description and points', async () => {
    answer(
      ok({
        movement: row({
          kind: 'redemption',
          amount_cents: null,
          cents_per_point: null,
          points: -30,
          description: 'Caffè offerto',
        }),
        balance: 70,
      }),
    );
    const result = await service.redeemFreeReward({
      operationId: OPERATION,
      customerId: CUSTOMER,
      description: 'Caffè offerto',
      points: 30,
    });
    expect(db.rpc).toHaveBeenCalledWith('redeem_free_reward', {
      p_operation_id: OPERATION,
      p_customer_id: CUSTOMER,
      p_description: 'Caffè offerto',
      p_points: 30,
    });
    expect(result.movement).toMatchObject({ kind: 'redemption', points: -30, rewardId: null });
    expect(result.balance).toBe(70);
  });

  it('cancelMovement calls app.cancel_movement and returns the correction', async () => {
    const CORRECTION = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
    answer(
      ok({
        movement: row({
          id: CORRECTION,
          kind: 'correction',
          amount_cents: null,
          cents_per_point: null,
          points: -12,
          corrects_movement_id: MOVEMENT,
          corrected_kind: 'purchase',
          corrected_created_at: '2026-11-18T09:00:00.123456+00:00',
        }),
        balance: 100,
      }),
    );
    const result = await service.cancelMovement({ operationId: OPERATION, movementId: MOVEMENT });
    expect(db.rpc).toHaveBeenCalledWith('cancel_movement', {
      p_operation_id: OPERATION,
      p_movement_id: MOVEMENT,
    });
    expect(result.movement).toMatchObject({
      id: CORRECTION,
      kind: 'correction',
      points: -12,
      correctsMovementId: MOVEMENT,
      correctedKind: 'purchase',
      correctedCreatedAt: '2026-11-18T09:00:00.123456+00:00',
    });
    expect(result.balance).toBe(100);
  });

  it("returns the server's points and balance, not ones computed in the client", async () => {
    // With 100 c per point 1250 c would be 12 points; the server applied 250 (the ratio in force).
    answer(ok({ movement: row({ points: 5, cents_per_point: 250 }), balance: 4321 }));
    const result = await service.recordPurchase({
      operationId: OPERATION,
      customerId: CUSTOMER,
      amountCents: 1250,
    });
    expect(result.movement.points).toBe(5);
    expect(result.movement.centsPerPoint).toBe(250);
    expect(result.balance).toBe(4321);
  });

  it('a replay answers whatever movement the server returns for the operation id', async () => {
    const FIRST = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
    answer(ok({ movement: row({ id: FIRST, amount_cents: 1250 }), balance: 12 }));
    const result = await service.recordPurchase({
      operationId: OPERATION,
      customerId: CUSTOMER,
      amountCents: 1250,
    });
    expect(result.movement.id).toBe(FIRST);
  });

  it.each([
    ['no movement', { balance: 1 }],
    ['a null answer', null],
    ['a fractional balance', { movement: row(), balance: 1.5 }],
    ['a string balance', { movement: row(), balance: '12' }],
    ['an unknown kind', { movement: row({ kind: 'gift' }), balance: 12 }],
    ['fractional points', { movement: row({ points: 1.5 }), balance: 12 }],
    ['a missing operator name', { movement: row({ operator_name: null }), balance: 12 }],
    ['an unknown corrected kind', { movement: row({ corrected_kind: 'correction' }), balance: 12 }],
  ])('an answer with %s rejects with unknown', async (_label, data) => {
    answer(ok(data));
    expect(
      await ledgerErrorOf(
        service.recordPurchase({ operationId: OPERATION, customerId: CUSTOMER, amountCents: 1250 }),
      ),
    ).toBe('unknown');
  });
});

describe('listMovements', () => {
  it('reads app.movement_history for the customer, newest first, 50 per page', async () => {
    answer(ok([row()]));
    const movements = await service.listMovements(CUSTOMER);
    expect(db.schema).toHaveBeenCalledWith('app');
    expect(db.from).toHaveBeenCalledWith('movement_history');
    expect(db.calls).toEqual([
      { method: 'select', args: [expect.not.stringContaining('*')] },
      { method: 'eq', args: ['customer_id', CUSTOMER] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'order', args: ['id', { ascending: false }] },
      { method: 'limit', args: [50] },
    ]);
    expect(movements).toEqual([movement]);
  });

  it('selects every column a Movement needs', async () => {
    answer(ok([]));
    await service.listMovements(CUSTOMER);
    const columns = String(db.calls[0]?.args[0])
      .split(',')
      .map((name) => name.trim());
    expect(columns.toSorted()).toEqual(Object.keys(row()).toSorted());
  });

  it('honours a smaller limit (4 in the customer page)', async () => {
    answer(ok([]));
    await service.listMovements(CUSTOMER, { limit: 4 });
    expect(db.calls).toContainEqual({ method: 'limit', args: [4] });
  });

  it('starts strictly after the cursor: older, or as old with a smaller id', async () => {
    answer(ok([]));
    const createdAt = '2026-11-18T09:00:00.123456+00:00';
    await service.listMovements(CUSTOMER, { before: { createdAt, id: MOVEMENT } });
    expect(db.calls).toContainEqual({
      method: 'or',
      args: [`created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${MOVEMENT})`],
    });
  });

  it.each([0, -1, 1.5, 51])('refuses a limit of %s without asking the server', async (limit) => {
    expect(await ledgerErrorOf(service.listMovements(CUSTOMER, { limit }))).toBe('invalid');
    expect(db.from).not.toHaveBeenCalled();
  });

  it('refuses a malformed cursor without asking the server', async () => {
    const before = { createdAt: 'x",id.gt.0', id: MOVEMENT };
    expect(await ledgerErrorOf(service.listMovements(CUSTOMER, { before }))).toBe('invalid');
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each([
    ['not an array', { id: MOVEMENT }],
    ['a malformed row', [row({ points: 'many' })]],
  ])('an answer that is %s rejects with unknown', async (_label, data) => {
    answer(ok(data));
    expect(await ledgerErrorOf(service.listMovements(CUSTOMER))).toBe('unknown');
  });
});

describe('error translation', () => {
  const translations = [
    ['EC001', 'insufficient-balance'],
    ['EC002', 'already-cancelled'],
    ['EC003', 'cancel-window-expired'],
    ['EC004', 'not-cancellable'],
    ['EC005', 'reward-unavailable'],
    ['EC006', 'customer-unavailable'],
    ['EC007', 'conflict'],
    ['42501', 'forbidden'],
    ['22023', 'invalid'],
  ] as const;

  it.each(translations)('lists %s as %s', (code, kind) => {
    expect(LEDGER_ERRCODES[code]).toBe(kind);
  });

  it.each(
    translations.flatMap(([code, kind]) =>
      writes.map(([name, run]) => [code, kind, name, run] as const),
    ),
  )('%s becomes %s on %s', async (code, kind, _name, run) => {
    answer(pgError(code, 400, 'refused'));
    expect(await ledgerErrorOf(run())).toBe(kind);
  });

  it('an unlisted code becomes unknown', async () => {
    answer(pgError('XX000', 400));
    expect(await ledgerErrorOf(writes[0][1]())).toBe('unknown');
  });

  it('a code inherited from Object.prototype is not a translation', async () => {
    answer(pgError('constructor', 400));
    expect(await ledgerErrorOf(writes[0][1]())).toBe('unknown');
  });

  it.each(operations)('%s: a failed fetch rejects with network', async (_name, run) => {
    answer(noResponse);
    expect(await ledgerErrorOf(run())).toBe('network');
  });

  it.each(operations)('%s: a thrown request rejects with network', async (_name, run) => {
    answer(new TypeError('Failed to fetch'));
    expect(await ledgerErrorOf(run())).toBe('network');
  });

  it.each(operations)('%s: a 500 without a known code rejects with unknown', async (_name, run) => {
    answer(pgError('', 500, 'Internal Server Error'));
    expect(await ledgerErrorOf(run())).toBe('unknown');
  });

  it.each(operations)('%s: a 503 is the server being unavailable', async (_name, run) => {
    answer(pgError('', 503, 'Service Unavailable'));
    const error = await rejection(run());
    expect(error).toBeInstanceOf(ServerFaultError);
    expect(error).toMatchObject({ kind: 'unavailable' });
  });

  it.each(operations)(
    '%s: a function missing from the API is misconfiguration',
    async (_name, run) => {
      answer(pgError('PGRST202', 404, 'Could not find the function'));
      const error = await rejection(run());
      expect(error).toBeInstanceOf(ServerFaultError);
      expect(error).toMatchObject({ kind: 'misconfigured' });
    },
  );

  it('a missing grant is misconfiguration, while a refused write is forbidden', async () => {
    answer(pgError('42501', 403, 'permission denied for function record_purchase'));
    expect(await rejection(writes[0][1]())).toMatchObject({ kind: 'misconfigured' });
    answer(pgError('42501', 400, 'No acting operator for this write'));
    expect(await ledgerErrorOf(writes[0][1]())).toBe('forbidden');
  });

  it('never puts the server message in the error', async () => {
    answer(pgError('EC001', 400, 'insufficient balance for Mario Rossi'));
    const error = await rejection(writes[0][1]());
    expect(String(error)).not.toContain('Mario');
  });
});

describe('timeout', () => {
  it('waits 8 seconds', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(8000);
  });

  it.each(operations)(
    '%s: no answer within 8 s rejects with network and aborts the request',
    async (_name, run) => {
      vi.useFakeTimers();
      answer('never');
      let settled: unknown = 'pending';
      const promise = run().then(
        () => 'resolved',
        (reason: unknown) => reason,
      );
      void promise.then((value) => {
        settled = value;
      });
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
      expect(settled).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);
      const error = await promise;
      expect(error).toBeInstanceOf(LedgerError);
      expect(error).toMatchObject({ kind: 'network' });
      expect(db.signals).toHaveLength(1);
      expect(db.signals[0]?.aborted).toBe(true);
    },
  );

  it('an answer just before 8 s wins and clears the timer', async () => {
    vi.useFakeTimers();
    let resolveAnswer: ((value: Answer) => void) | undefined;
    db.answer = () =>
      new Promise((resolve) => {
        resolveAnswer = resolve;
      });
    const promise = service.recordPurchase({
      operationId: OPERATION,
      customerId: CUSTOMER,
      amountCents: 1250,
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    resolveAnswer?.(ok({ movement: row(), balance: 12 }));
    await expect(promise).resolves.toEqual({ movement, balance: 12 });
    expect(vi.getTimerCount()).toBe(0);
    expect(db.signals[0]?.aborted).toBe(false);
  });
});
