import { vi } from 'vitest';
import type { Operator } from '../features/identity/types';
import { REQUEST_TIMEOUT_MS } from '../features/ledger/supabaseLedgerService';
import { LedgerError } from '../features/ledger/types';
import type {
  LedgerErrorKind,
  LedgerResult,
  LedgerService,
  Movement,
} from '../features/ledger/types';
import { fakeOperator } from './fakeAuthService';
import { createFakeCustomerService } from './fakeCustomerService';
import { createFakeRewardsService } from './fakeRewardsService';
import { createFakeSettingsService } from './fakeSettingsService';

type Method = keyof LedgerService;

/**
 * What a programmed call does instead of answering: reject with a `LedgerError` of that kind or
 * with that error (a `ServerFaultError`, say) without changing anything; `'timeout'`: no answer
 * within 8 s, then `network`, nothing written; `'lost'`: the call reaches the server and is
 * applied, but the answer never arrives (rejects with `network`).
 */
export type FakeLedgerFailure = LedgerErrorKind | 'timeout' | 'lost' | Error;

/** One logged call: the method and the arguments it received. */
export type FakeLedgerCall = { method: Method; args: unknown[] };

type FakeCustomers = ReturnType<typeof createFakeCustomerService>;
type FakeRewards = ReturnType<typeof createFakeRewardsService>;
type FakeSettings = ReturnType<typeof createFakeSettingsService>;

type FakeOptions = {
  /** Who the customers are and where their balance lives; a new empty fake when missing. */
  customers?: FakeCustomers;
  /** The catalog `redeemReward` reads; a new empty fake when missing. */
  rewards?: FakeRewards;
  /** The ratio in force `recordPurchase` reads; the migration's defaults when missing. */
  settings?: FakeSettings;
  /** History already on the server. Only history: their points are not added to any balance. */
  movements?: Movement[];
  /** Who writes; null: no operator profile, every write is `forbidden`. */
  operator?: Operator | null;
};

// The checks of the ledger migration (docs/specs/SPEC-ledger.md).
const MAX_AMOUNT_CENTS = 9_999_999;
const MAX_REWARD_POINTS = 99_999;
const DESCRIPTION_MAX = 80;
const CANCEL_WINDOW_MS = 10_000;
const PAGE_SIZE = 50;
let nextFixture = 0;

/** A purchase as `movement_history` returns it, with a fresh UUID-shaped id; for `movements`. */
export function fakeMovement(overrides: Partial<Movement> = {}): Movement {
  nextFixture += 1;
  const counter = String(nextFixture).padStart(12, '0');
  return {
    id: `00000000-0000-4000-d000-${counter}`,
    operationId: `00000000-0000-4000-e000-${counter}`,
    customerId: '00000000-0000-4000-8000-000000000001',
    kind: 'purchase',
    amountCents: 1500,
    points: 15,
    centsPerPoint: 100,
    rewardId: null,
    description: null,
    operatorId: fakeOperator.id,
    operatorName: fakeOperator.name,
    createdAt: '2026-11-17T18:10:00.000Z',
    correctsMovementId: null,
    cancelledById: null,
    cancelledAt: null,
    correctedKind: null,
    correctedCreatedAt: null,
    ...overrides,
  };
}

function fail(kind: LedgerErrorKind): never {
  throw new LedgerError(kind);
}

/** `private.trim_spaces`: every outer Unicode space, as in the rewards fake. */
function trimSpaces(text: string): string {
  return text.replace(/^\s+|\s+$/g, '');
}

/** `p_operation_id is null` → 22023; the fake accepts any other id (no uuid check). */
function checkOperationId(operationId: string) {
  if (operationId === '') fail('invalid');
}

/** Newest first, as the view is read: `created_at desc, id desc`. */
function newestFirst(a: Movement, b: Movement): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

function perMethod<T>(make: () => T): Record<Method, T> {
  return {
    recordPurchase: make(),
    redeemReward: make(),
    redeemFreeReward: make(),
    cancelMovement: make(),
    listMovements: make(),
  };
}

/**
 * In-memory LedgerService for component tests, following the rules and the order of checks of
 * the ledger RPCs: operator (`forbidden`), customer (`customer-unavailable`; a cancellation also
 * on an anonymized customer), replay of the same `operationId` (same parameters: the first
 * movement with the current balance; otherwise `conflict`), then values (`invalid`), reward,
 * balance never below zero, the 10-second window of an operator's own movement, points already
 * spent. Points of a purchase are rounded down with the ratio in force in `settings`, saved on
 * the movement. The balance lives in the customers fake (its starting value stands for older
 * movements): every movement adds its points there, and a purchase or a redemption puts the
 * customer at the top of "Serviti oggi". The clock is `Date.now()` (so `vi.setSystemTime`
 * drives it) plus `advanceClock`. Every method is a `vi.fn` and every call is also logged in
 * `calls`. `failNext` programs a failure (a timeout, an answer lost after the write), `holdNext`
 * delays an answer until released, `setNetworkDown` makes every call fail with `network`.
 */
export function createFakeLedgerService({
  customers = createFakeCustomerService(),
  rewards = createFakeRewardsService(),
  settings = createFakeSettingsService(),
  movements: initial = [],
  operator: initialOperator = fakeOperator,
}: FakeOptions = {}) {
  const stored = new Map(initial.map((movement) => [movement.id, { ...movement }]));
  const byOperation = new Map(initial.map((movement) => [movement.operationId, movement.id]));
  let operator = initialOperator;
  let offsetMs = 0;
  let created = 0;
  let networkDown = false;
  const failures = perMethod<FakeLedgerFailure[]>(() => []);
  const holds = perMethod<Promise<void>[]>(() => []);
  const calls: FakeLedgerCall[] = [];

  const nowMs = () => Date.now() + offsetMs;

  function customerOf(id: string) {
    return customers.customers().find((customer) => customer.id === id) ?? null;
  }

  function balanceOf(customerId: string): number {
    return customerOf(customerId)?.balance ?? 0;
  }

  /** Step 1: who writes. */
  function acting(): Operator {
    return operator ?? fail('forbidden');
  }

  /** Step 2: the customer must exist and not be anonymized. */
  function checkCustomer(customerId: string) {
    const customer = customerOf(customerId);
    if (!customer || customer.anonymizedAt !== null) fail('customer-unavailable');
  }

  function resultFor(movement: Movement): LedgerResult {
    return { movement: { ...movement }, balance: balanceOf(movement.customerId) };
  }

  /** Step 3: the first result for a resent `operationId`, `conflict` when it differs, else null. */
  function replay(operationId: string, same: (movement: Movement) => boolean) {
    const existing = stored.get(byOperation.get(operationId) ?? '');
    if (!existing) return null;
    if (!same(existing)) fail('conflict');
    return resultFor(existing);
  }

  type NewMovement = Pick<Movement, 'operationId' | 'customerId' | 'kind' | 'points'> &
    Partial<Movement>;

  function insert(row: NewMovement, by: Operator): LedgerResult {
    created += 1;
    const movement: Movement = {
      id: `00000000-0000-4000-c000-${String(created).padStart(12, '0')}`,
      amountCents: null,
      centsPerPoint: null,
      rewardId: null,
      description: null,
      operatorId: by.id,
      operatorName: by.name,
      createdAt: new Date(nowMs()).toISOString(),
      correctsMovementId: null,
      cancelledById: null,
      cancelledAt: null,
      correctedKind: null,
      correctedCreatedAt: null,
      ...row,
    };
    stored.set(movement.id, movement);
    byOperation.set(movement.operationId, movement.id);
    const served = movement.kind === 'correction' ? null : movement.createdAt;
    customers.applyMovement(movement.customerId, movement.points, served);
    return resultFor(movement);
  }

  /** Logs the call, then answers it as programmed (network, failure, hold) or with `compute`. */
  function run<T>(method: Method, args: unknown[], compute: () => T): Promise<T> {
    calls.push({ method, args });
    const failure = failures[method].shift();
    const hold = holds[method].shift();
    const down = networkDown;
    // Built only when it is due, so a held rejection is never left unhandled meanwhile.
    const answer = async () => {
      if (down) fail('network');
      if (failure instanceof Error) throw failure;
      if (failure === 'timeout') {
        await new Promise((resolve) => setTimeout(resolve, REQUEST_TIMEOUT_MS));
        fail('network');
      }
      if (failure !== undefined && failure !== 'lost') fail(failure);
      const result = compute();
      if (failure === 'lost') fail('network');
      return result;
    };
    return hold ? hold.then(answer) : answer();
  }

  const service = {
    recordPurchase: vi.fn<LedgerService['recordPurchase']>((input) =>
      run('recordPurchase', [input], () => {
        const { operationId, customerId, amountCents } = input;
        const by = acting();
        checkCustomer(customerId);
        const resent = replay(
          operationId,
          (m) =>
            m.kind === 'purchase' && m.customerId === customerId && m.amountCents === amountCents,
        );
        if (resent) return resent;
        checkOperationId(operationId);
        if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
          fail('invalid');
        }
        const { centsPerPoint } = settings.current();
        const points = Math.floor(amountCents / centsPerPoint);
        return insert(
          { operationId, customerId, kind: 'purchase', amountCents, points, centsPerPoint },
          by,
        );
      }),
    ),
    redeemReward: vi.fn<LedgerService['redeemReward']>((input) =>
      run('redeemReward', [input], () => {
        const { operationId, customerId, rewardId } = input;
        const by = acting();
        checkCustomer(customerId);
        const resent = replay(
          operationId,
          (m) => m.kind === 'redemption' && m.customerId === customerId && m.rewardId === rewardId,
        );
        if (resent) return resent;
        checkOperationId(operationId);
        const reward = rewards.rewards().find((row) => row.id === rewardId);
        if (!reward?.active) fail('reward-unavailable');
        if (balanceOf(customerId) - reward.points < 0) fail('insufficient-balance');
        return insert(
          {
            operationId,
            customerId,
            kind: 'redemption',
            points: -reward.points,
            rewardId: reward.id,
            description: reward.name,
          },
          by,
        );
      }),
    ),
    redeemFreeReward: vi.fn<LedgerService['redeemFreeReward']>((input) =>
      run('redeemFreeReward', [input], () => {
        const { operationId, customerId, points } = input;
        const description = trimSpaces(input.description);
        const by = acting();
        checkCustomer(customerId);
        const resent = replay(
          operationId,
          (m) =>
            m.kind === 'redemption' &&
            m.rewardId === null &&
            m.customerId === customerId &&
            m.description === description &&
            m.points === -points,
        );
        if (resent) return resent;
        checkOperationId(operationId);
        const length = Array.from(description).length;
        if (length < 1 || length > DESCRIPTION_MAX) fail('invalid');
        if (!Number.isInteger(points) || points < 1 || points > MAX_REWARD_POINTS) fail('invalid');
        if (balanceOf(customerId) - points < 0) fail('insufficient-balance');
        return insert(
          { operationId, customerId, kind: 'redemption', points: -points, description },
          by,
        );
      }),
    ),
    cancelMovement: vi.fn<LedgerService['cancelMovement']>((input) =>
      run('cancelMovement', [input], () => {
        const { operationId, movementId } = input;
        const by = acting();
        // The movement's customer is locked even when anonymized (Open Question 14).
        const target = stored.get(movementId) ?? fail('customer-unavailable');
        const resent = replay(
          operationId,
          (m) => m.kind === 'correction' && m.correctsMovementId === movementId,
        );
        if (resent) return resent;
        checkOperationId(operationId);
        if (target.kind === 'correction') fail('not-cancellable');
        if (target.cancelledById !== null) fail('already-cancelled');
        const age = nowMs() - Date.parse(target.createdAt);
        if (by.role !== 'admin' && (target.operatorId !== by.id || age > CANCEL_WINDOW_MS)) {
          fail('cancel-window-expired');
        }
        if (target.kind === 'purchase' && balanceOf(target.customerId) - target.points < 0) {
          fail('insufficient-balance');
        }
        const result = insert(
          {
            operationId,
            customerId: target.customerId,
            kind: 'correction',
            points: -target.points,
            correctsMovementId: target.id,
            correctedKind: target.kind,
            correctedCreatedAt: target.createdAt,
          },
          by,
        );
        Object.assign(target, {
          cancelledById: result.movement.id,
          cancelledAt: result.movement.createdAt,
        });
        return result;
      }),
    ),
    listMovements: vi.fn<LedgerService['listMovements']>((customerId, options = {}) =>
      run('listMovements', [customerId, options], () => {
        const limit = options.limit ?? PAGE_SIZE;
        if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE) fail('invalid');
        const { before } = options;
        // The view's RLS shows nothing to an account without an operator profile.
        if (!operator) return [];
        return [...stored.values()]
          .filter((movement) => movement.customerId === customerId)
          .filter(
            (movement) =>
              !before ||
              movement.createdAt < before.createdAt ||
              (movement.createdAt === before.createdAt && movement.id < before.id),
          )
          .toSorted(newestFirst)
          .slice(0, limit)
          .map((movement) => ({ ...movement }));
      }),
    ),
  } satisfies LedgerService;

  return {
    service,
    /** The customers fake that holds the balances. */
    customers,
    /** Every call, in order, with its arguments. */
    calls,
    /** Every stored movement, as copies, in insertion order (seeded ones first). */
    movements: () => [...stored.values()].map((movement) => ({ ...movement })),
    /** Who writes from now on; null: no operator profile (`forbidden`). */
    setOperator(next: Operator | null) {
      operator = next;
    },
    /** Moves the fake's clock forward, for the 10-second window. */
    advanceClock(ms: number) {
      offsetMs += ms;
    },
    /** Programs the next call of `method` (queued: one failure per call, in order). */
    failNext(method: Method, failure: FakeLedgerFailure) {
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
