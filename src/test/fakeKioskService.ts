import { vi } from 'vitest';
import type { Operator } from '../features/identity/types';
import { KioskError } from '../features/tablet-kiosk/types';
import type {
  Cashier,
  KioskErrorKind,
  KioskService,
  SetPinResult,
  UnlockResult,
} from '../features/tablet-kiosk/types';

type Method = keyof KioskService;

/** The turn of a cashier, from the unlock (`app.unlock_cashier`: 12 hours). */
export const KIOSK_TURN_MS = 12 * 60 * 60 * 1000;
/** The lock after the 5th wrong PIN in a row (`app.unlock_cashier`: 5 minutes). */
export const KIOSK_LOCK_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const PIN = /^[0-9]{4}$/;

/**
 * What a programmed call does instead of answering: reject with a `KioskError` of that kind or
 * with that error (a `ServerFaultError`) without changing anything, or `'lost'`: the call is
 * applied but the answer never arrives. A `network` failure (also `lost`) resolves `unlock` and
 * `setMyPin` with `{ status: 'network' }`, like the Supabase service.
 */
export type FakeKioskFailure = KioskErrorKind | 'lost' | Error;

/** One logged call. The PIN is never logged: only which operator an unlock was for. */
export type FakeKioskCall = { method: Method; operatorId?: string };

/** An operator as the fake keeps it: the PIN in clear (the server keeps only its bcrypt hash). */
export type FakeCashier = Operator & { pin: string | null };

/** The account the fake answers for: a tablet, or an operator's phone (the only one with a PIN). */
type Account = { kind: 'device' } | { kind: 'operator'; operatorId: string };

type FakeOptions = {
  /** The linked operators; an admin and an operator with a PIN, and one without, when missing. */
  cashiers?: FakeCashier[];
  account?: Account;
  /** The device's cashier at the start, with a turn that has just begun. */
  cashierId?: string;
  /** The device starts locked for this long, as after 5 wrong PINs. */
  lockedForMs?: number;
  /** The server's clock, in milliseconds; `Date.now` (fake timers included) when missing. */
  now?: () => number;
};

let nextFixture = 0;

/** A linked operator with a fake name, a fresh UUID-shaped id and the PIN 0000. */
export function fakeCashier(overrides: Partial<FakeCashier> = {}): FakeCashier {
  nextFixture += 1;
  const counter = String(nextFixture).padStart(12, '0');
  return {
    id: `00000000-0000-4000-e000-${counter}`,
    name: `Cassiere Prova ${counter.slice(-4)}`,
    role: 'operator',
    pin: '0000',
    ...overrides,
  };
}

function defaultCashiers(): FakeCashier[] {
  return [
    fakeCashier({ name: 'Giulia Prova', role: 'admin', pin: '1234' }),
    fakeCashier({ name: 'Marco Prova', pin: '5678' }),
    fakeCashier({ name: 'Sara Prova', pin: null }),
  ];
}

function perMethod<T>(make: () => T): Record<Method, T> {
  return { listCashiers: make(), unlock: make(), endTurn: make(), setMyPin: make() };
}

/** Reached the server or not: the answer of a network failure where a method resolves it. */
class NoAnswer extends Error {}

function profile({ id, name, role }: FakeCashier): Operator {
  return { id, name, role };
}

/** `unlock` and `setMyPin` resolve with `network` when there is no answer; the others reject. */
function resolvingNetwork<T>(pending: Promise<T>): Promise<T | { status: 'network' }> {
  return pending.catch((error: unknown) => {
    if (error instanceof NoAnswer) return { status: 'network' as const };
    throw error;
  });
}

function rejectingNetwork<T>(pending: Promise<T>): Promise<T> {
  return pending.catch((error: unknown) => {
    throw error instanceof NoAnswer ? new KioskError('network') : error;
  });
}

/**
 * In-memory KioskService for component tests, following `app.unlock_cashier` and the other kiosk
 * RPCs: one device with a counter of wrong PINs on any operator (the 5th locks it for 5 minutes and
 * resets the counter), no PIN check at all during a lock, a success that resets the counter and
 * starts a 12-hour turn, a malformed PIN refused as `invalid` without counting, `no-pin` for an
 * operator without a PIN (or unknown), `setMyPin` for operator accounts only, closing that person's
 * turn. The clock is `now`, so a test moves the lock and the turn by hand or with fake timers.
 * Every method is a `vi.fn` and every call is also logged in `calls`, without the PIN.
 * `failNext` programs a failure, `holdNext` delays an answer until released, `setNetworkDown`
 * makes every call fail with `network`.
 */
export function createFakeKioskService({
  cashiers: initial = defaultCashiers(),
  account = { kind: 'device' },
  cashierId,
  lockedForMs,
  now = () => Date.now(),
}: FakeOptions = {}) {
  const operators = new Map(initial.map((cashier) => [cashier.id, { ...cashier }]));
  let cashier: { id: string; since: number } | null = cashierId
    ? { id: cashierId, since: now() }
    : null;
  let failedAttempts = 0;
  let lockedUntil: number | null = lockedForMs === undefined ? null : now() + lockedForMs;
  let networkDown = false;
  const failures = perMethod<FakeKioskFailure[]>(() => []);
  const holds = perMethod<Promise<void>[]>(() => []);
  const calls: FakeKioskCall[] = [];

  /** The cashier while the turn lasts; null once it has ended (as `acting_operator_id()`). */
  function currentCashier(): FakeCashier | null {
    if (!cashier || now() >= cashier.since + KIOSK_TURN_MS) return null;
    return operators.get(cashier.id) ?? null;
  }

  function lockSecondsLeft(): number | null {
    const left = lockedUntil === null ? 0 : lockedUntil - now();
    return left > 0 ? Math.ceil(left / 1000) : null;
  }

  function requireDevice(): void {
    if (account.kind !== 'device') throw new KioskError('forbidden');
  }

  function savePin(operatorId: string, pin: string): void {
    const operator = operators.get(operatorId);
    if (!operator) throw new Error(`fakeKioskService: no operator ${operatorId}`);
    operator.pin = pin;
    // set_my_pin closes that person's open turns on every tablet.
    if (cashier?.id === operatorId) cashier = null;
  }

  function unlock(operatorId: string, pin: string): UnlockResult {
    requireDevice();
    if (!PIN.test(pin)) throw new KioskError('invalid');
    const locked = lockSecondsLeft();
    if (locked !== null) return { status: 'locked', lockSecondsLeft: locked };
    const operator = operators.get(operatorId);
    if (!operator?.pin) return { status: 'no-pin' };
    if (operator.pin !== pin) {
      failedAttempts += 1;
      if (failedAttempts >= MAX_ATTEMPTS) {
        failedAttempts = 0;
        lockedUntil = now() + KIOSK_LOCK_MS;
        return { status: 'locked', lockSecondsLeft: KIOSK_LOCK_MS / 1000 };
      }
      return { status: 'wrong-pin', attemptsLeft: MAX_ATTEMPTS - failedAttempts };
    }
    const since = now();
    cashier = { id: operator.id, since };
    failedAttempts = 0;
    lockedUntil = null;
    return {
      status: 'ok',
      cashier: profile(operator),
      turnExpiresAt: new Date(since + KIOSK_TURN_MS),
    };
  }

  /** Logs the call, then answers it as programmed (network, failure, hold) or with `compute`. */
  function run<T>(call: FakeKioskCall, compute: () => T): Promise<T> {
    calls.push(call);
    const failure = failures[call.method].shift();
    const hold = holds[call.method].shift();
    const down = networkDown;
    // Built only when it is due, so a held rejection is never left unhandled meanwhile.
    const answer = async () => {
      if (down || failure === 'network') throw new NoAnswer();
      if (failure instanceof Error) throw failure;
      if (failure !== undefined && failure !== 'lost') throw new KioskError(failure);
      const result = compute();
      if (failure === 'lost') throw new NoAnswer();
      return result;
    };
    return hold ? hold.then(answer) : answer();
  }

  const service = {
    listCashiers: vi.fn<KioskService['listCashiers']>(() =>
      rejectingNetwork(
        run({ method: 'listCashiers' }, (): Cashier[] => {
          requireDevice();
          return [...operators.values()].map((operator) => ({
            ...profile(operator),
            hasPin: operator.pin !== null,
          }));
        }),
      ),
    ),
    unlock: vi.fn<KioskService['unlock']>((operatorId, pin) =>
      resolvingNetwork(run({ method: 'unlock', operatorId }, () => unlock(operatorId, pin))),
    ),
    endTurn: vi.fn<KioskService['endTurn']>(() =>
      rejectingNetwork(
        run({ method: 'endTurn' }, () => {
          requireDevice();
          cashier = null;
        }),
      ),
    ),
    setMyPin: vi.fn<KioskService['setMyPin']>((pin) =>
      resolvingNetwork(
        run({ method: 'setMyPin' }, (): SetPinResult => {
          if (account.kind !== 'operator') throw new KioskError('forbidden');
          if (!PIN.test(pin)) throw new KioskError('invalid');
          savePin(account.operatorId, pin);
          return { status: 'ok' };
        }),
      ),
    ),
  } satisfies KioskService;

  return {
    service,
    /** Every call, in order, without the PIN. */
    calls,
    /** The device as `app.get_session_identity` would describe it, read against `now`. */
    device() {
      const current = currentCashier();
      return {
        cashier: current ? profile(current) : null,
        turnExpiresAt: current && cashier ? new Date(cashier.since + KIOSK_TURN_MS) : null,
        failedAttempts,
        lockSecondsLeft: lockSecondsLeft(),
      };
    },
    /** Whether the operator has a PIN (never the PIN itself, as the server). */
    hasPin(operatorId: string) {
      return (operators.get(operatorId)?.pin ?? null) !== null;
    },
    /** Sets a PIN as `set_my_pin` from that person's phone would (closing their turn). */
    setPin(operatorId: string, pin: string) {
      savePin(operatorId, pin);
    },
    /** Ends the turn as the 12 hours would, without moving the clock. */
    expireTurn() {
      if (cashier) cashier = { ...cashier, since: now() - KIOSK_TURN_MS };
    },
    /** Programs the next call of `method` (queued: one failure per call, in order). */
    failNext(method: Method, failure: FakeKioskFailure) {
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
    /** While down, every call fails with `network` and changes nothing. */
    setNetworkDown(down: boolean) {
      networkDown = down;
    },
  };
}
