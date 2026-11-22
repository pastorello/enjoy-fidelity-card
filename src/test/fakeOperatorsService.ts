import { vi } from 'vitest';
import type { Role } from '../features/identity/types';
import type {
  CancelInviteResult,
  InviteInput,
  InviteResult,
  ListOperatorsResult,
  Operator,
  OperatorChangeResult,
  OperatorStatus,
  OperatorsService,
  ResendResult,
} from '../features/operators/types';

type Method = keyof OperatorsService;

/** The failure statuses a method can resolve with (its success excluded). */
type FailureOf<M extends Method> = Exclude<
  Awaited<ReturnType<OperatorsService[M]>>['status'],
  'ok' | 'invited' | 'resent' | 'cancelled'
>;

/**
 * What a programmed call does instead of answering: resolve with that failure status without
 * changing anything (`email-taken` with `deactivated: false`); an `Error` (a `ServerFaultError`) is
 * thrown as it is; `'lost'`: the call reaches the server and is applied, but the answer never
 * arrives (it resolves with `network`).
 */
export type FakeOperatorsFailure<M extends Method = Method> = FailureOf<M> | 'lost' | Error;

/** One logged call: the method and the arguments it received (fake emails only). */
export type FakeOperatorsCall = { method: Method; args: unknown[] };

/** An email Auth would have sent: an invite, or a recovery link once the email is confirmed. */
export type FakeOperatorsEmail = {
  kind: 'invite' | 'recovery';
  to: string;
  name: string;
  invitedBy: string;
};

/**
 * A profile as the fake keeps it: the Auth account folded in (`email` null = removed, no account),
 * `emailConfirmed` and `hasPassword` as `auth.users` (both true = invite accepted).
 */
export type FakeOperator = {
  id: string;
  name: string;
  role: Role;
  email: string | null;
  emailConfirmed: boolean;
  hasPassword: boolean;
  deactivated: boolean;
  hasPin: boolean;
};

type Caller = {
  /** `acting_operator_id()`: the account on the phone, the cashier on a device (null: none). */
  actingId?: string | null;
  /** A tablet: `current_device_id()` is not null (no admin is named from there). */
  onDevice?: boolean;
};

type FakeOptions = Caller & {
  /** The profiles; an admin (the caller) and an operator, both active, when missing. */
  operators?: FakeOperator[];
  /** Emails of device accounts (`email_is_device`). */
  deviceEmails?: string[];
};

const NAME_MAX = 60;
const EMAIL_MAX = 254;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
let nextFixture = 0;

/** An active profile with a fake name, a fresh UUID-shaped id and a fake email. */
export function fakeOperator(overrides: Partial<FakeOperator> = {}): FakeOperator {
  nextFixture += 1;
  const counter = String(nextFixture).padStart(12, '0');
  return {
    id: `00000000-0000-4000-f000-${counter}`,
    name: `Operatore Prova ${counter.slice(-4)}`,
    role: 'operator',
    email: `prova${counter.slice(-4)}@esempio.it`,
    emailConfirmed: true,
    hasPassword: true,
    deactivated: false,
    hasPin: false,
    ...overrides,
  };
}

/** `private.clean_name`: inner whitespace runs (Unicode spaces too) collapsed to one, trimmed. */
function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function statusOf(operator: FakeOperator): OperatorStatus {
  if (operator.email === null) return 'removed';
  if (operator.deactivated) return 'deactivated';
  return operator.emailConfirmed && operator.hasPassword ? 'active' : 'invited';
}

/** `operator_rows`' order: deactivated and removed last, then `lower(name)`, then `id`. */
function compare(a: FakeOperator, b: FakeOperator): number {
  const away = (operator: FakeOperator) =>
    operator.email === null || operator.deactivated ? 1 : 0;
  const byAway = away(a) - away(b);
  if (byAway !== 0) return byAway;
  const [nameA, nameB] = [a.name.toLowerCase(), b.name.toLowerCase()];
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function perMethod<T>(make: () => T): Record<Method, T> {
  return {
    list: make(),
    setRole: make(),
    setActive: make(),
    invite: make(),
    resendInvite: make(),
    cancelInvite: make(),
  };
}

/** A refusal of the server, answered as `{ status }` by the method that met it. */
class Refusal extends Error {
  constructor(readonly status: AnyFailure) {
    super(status);
  }
}

type AnyFailure = FailureOf<Method>;
type ResultOf<M extends Method> = Awaited<ReturnType<OperatorsService[M]>>;

const COMMON = ['forbidden', 'network', 'unknown'] as const;
const CHANGE = [
  ...COMMON,
  'last-admin',
  'self',
  'no-account',
  'not-found',
  'admin-from-device',
] as const;

/** `status` when `allowed` has it, `unknown` otherwise (never happens: failures are typed by method). */
function pick<S extends string>(allowed: readonly S[], status: string, fallback: S): S {
  return allowed.find((candidate) => candidate === status) ?? fallback;
}

/** How each method answers a failure status (a refusal of the server, or a programmed one). */
const REFUSED: { [M in Method]: (status: AnyFailure) => ResultOf<M> } = {
  list: (status) => ({ status: pick(COMMON, status, 'unknown') }),
  setRole: (status) => ({ status: pick(CHANGE, status, 'unknown') }),
  setActive: (status) => ({ status: pick(CHANGE, status, 'unknown') }),
  invite: (status) =>
    status === 'email-taken'
      ? { status, deactivated: false }
      : {
          status: pick(
            [
              ...COMMON,
              'name-taken',
              'email-is-device',
              'in-progress',
              'rate-limited',
              'admin-from-device',
            ] as const,
            status,
            'unknown',
          ),
        },
  resendInvite: (status) => ({
    status: pick([...COMMON, 'not-invited', 'self', 'rate-limited'] as const, status, 'unknown'),
  }),
  cancelInvite: (status) => ({
    status: pick([...COMMON, 'not-invited', 'self'] as const, status, 'unknown'),
  }),
};

type Reservation = {
  name: string;
  email: string;
  role: Role;
  requestedBy: string;
  status: 'done' | 'failed';
  operatorId: string | null;
};

/**
 * In-memory OperatorsService for component tests, following the operators RPCs and the
 * operator-invites function: statuses computed as `list_operators` (`invited` until the email is
 * confirmed and a password is set), the same order, `is_admin()` for the caller (an active admin,
 * or an admin cashier on a device), the checks of `lock_operator_target` in order (forbidden,
 * not-found, self, no-account), `admin-from-device` for a role or an invite of an admin from a
 * device, the last-admin rule (another active admin with an accepted invite), invites idempotent
 * on `operationId` (the same id with other fields is `unknown`, like 22023), taken name, taken
 * email (`deactivated`), device email, relink of a removed profile with the same name, resend and
 * cancel only for `invited` (`not-invited` also for an unknown id, as the function), cancel
 * leaving the profile `removed`. Every method is a `vi.fn` and every call is also logged in
 * `calls`; the emails Auth would send are in `emails`. `failNext` programs a failure (also an
 * answer lost after the change was applied), `holdNext` delays an answer until released,
 * `setNetworkDown` makes every call resolve `network`. `in-progress` and `rate-limited` happen
 * only when programmed.
 */
export function createFakeOperatorsService({
  operators: initial,
  actingId,
  onDevice = false,
  deviceEmails = [],
}: FakeOptions = {}) {
  const seed = initial ?? [
    fakeOperator({ name: 'Giulia Prova', role: 'admin' }),
    fakeOperator({ name: 'Marco Prova' }),
  ];
  const stored = new Map(seed.map((operator) => [operator.id, { ...operator }]));
  const devices = new Set(deviceEmails.map((email) => email.toLowerCase()));
  const reservations = new Map<string, Reservation>();
  let caller: Required<Caller> = {
    actingId:
      actingId === undefined ? (seed.find((o) => o.role === 'admin')?.id ?? null) : actingId,
    onDevice,
  };
  let networkDown = false;
  const failures = perMethod<FakeOperatorsFailure[]>(() => []);
  const holds = perMethod<Promise<void>[]>(() => []);
  const calls: FakeOperatorsCall[] = [];
  const emails: FakeOperatorsEmail[] = [];
  let created = 0;

  function row(operator: FakeOperator): Operator {
    return {
      id: operator.id,
      name: operator.name,
      role: operator.role,
      status: statusOf(operator),
      email: operator.email,
      hasPin: operator.hasPin,
      isMe: operator.id === caller.actingId,
    };
  }

  /** `private.is_admin()`: the acting person is an admin, not deactivated, with an account. */
  function requireAdmin(): FakeOperator {
    const acting = caller.actingId === null ? undefined : stored.get(caller.actingId);
    if (!acting || acting.role !== 'admin' || acting.deactivated || acting.email === null) {
      throw new Refusal('forbidden');
    }
    return acting;
  }

  /** `private.lock_operator_target`: forbidden, not-found, self, no-account. */
  function target(operatorId: string): FakeOperator {
    requireAdmin();
    const operator = stored.get(operatorId);
    if (!operator) throw new Refusal('not-found');
    if (operator.id === caller.actingId) throw new Refusal('self');
    if (operator.email === null) throw new Refusal('no-account');
    return operator;
  }

  /** `private.assert_other_admin`: EO001 unless another active admin has accepted the invite. */
  function assertOtherAdmin(operator: FakeOperator): void {
    if (operator.role !== 'admin' || operator.deactivated) return;
    const other = [...stored.values()].some(
      (o) => o.id !== operator.id && o.role === 'admin' && statusOf(o) === 'active',
    );
    if (!other) throw new Refusal('last-admin');
  }

  /** `private.invited_target`: forbidden, self, not-invited (an unknown id too). */
  function invitedTarget(operatorId: string): FakeOperator {
    requireAdmin();
    const operator = stored.get(operatorId);
    if (operator?.id === caller.actingId) throw new Refusal('self');
    if (!operator || statusOf(operator) !== 'invited') throw new Refusal('not-invited');
    return operator;
  }

  function invite(input: InviteInput): InviteResult {
    const acting = requireAdmin();
    const name = cleanName(input.name);
    const email = input.email.trim().toLowerCase();
    const nameLength = Array.from(name).length;
    if (nameLength < 1 || nameLength > NAME_MAX || email.length > EMAIL_MAX || !EMAIL.test(email)) {
      throw new Refusal('unknown');
    }
    if (input.role === 'admin' && caller.onDevice) throw new Refusal('admin-from-device');

    const reserved = reservations.get(input.operationId);
    if (reserved) {
      const same =
        reserved.name === name &&
        reserved.email === email &&
        reserved.role === input.role &&
        reserved.requestedBy === acting.id;
      if (!same) throw new Refusal('unknown');
      const done = reserved.operatorId === null ? undefined : stored.get(reserved.operatorId);
      if (reserved.status === 'done' && done) {
        return { status: 'invited', operator: { id: done.id, name: done.name, role: done.role } };
      }
    }
    const reservation: Reservation = {
      name,
      email,
      role: input.role,
      requestedBy: acting.id,
      status: 'failed',
      operatorId: null,
    };
    reservations.set(input.operationId, reservation);

    const people = [...stored.values()];
    if (devices.has(email)) return { status: 'email-is-device' };
    const owner = people.find((o) => o.email?.toLowerCase() === email);
    if (owner) return { status: 'email-taken', deactivated: owner.deactivated };
    const named = people.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (named && named.email !== null) return { status: 'name-taken' };

    let operator: FakeOperator;
    if (named) {
      // Relinked as operator_invite_finish does: the new account, the new role, reactivated.
      Object.assign(named, {
        email,
        role: input.role,
        emailConfirmed: false,
        hasPassword: false,
        deactivated: false,
      });
      operator = named;
    } else {
      created += 1;
      operator = {
        id: `00000000-0000-4000-b000-${String(created).padStart(12, '0')}`,
        name,
        role: input.role,
        email,
        emailConfirmed: false,
        hasPassword: false,
        deactivated: false,
        hasPin: false,
      };
      stored.set(operator.id, operator);
    }
    emails.push({ kind: 'invite', to: email, name, invitedBy: acting.name });
    reservation.status = 'done';
    reservation.operatorId = operator.id;
    return {
      status: 'invited',
      operator: { id: operator.id, name: operator.name, role: operator.role },
    };
  }

  /**
   * Logs the call, then answers it as programmed (network, failure, hold) or with `compute`; a
   * `Refusal` thrown by `compute` resolves as that method's `{ status }`.
   */
  function run<M extends Method>(
    method: M,
    args: unknown[],
    compute: () => ResultOf<M>,
  ): Promise<ResultOf<M>> {
    calls.push({ method, args });
    const failure = failures[method].shift();
    const hold = holds[method].shift();
    const down = networkDown;
    const refused = REFUSED[method];
    // Built only when it is due, so a held rejection is never left unhandled meanwhile.
    const answer = async (): Promise<ResultOf<M>> => {
      if (down) return refused('network');
      if (failure instanceof Error) throw failure;
      if (failure !== undefined && failure !== 'lost') return refused(failure);
      let result: ResultOf<M>;
      try {
        result = compute();
      } catch (error) {
        if (error instanceof Refusal) return refused(error.status);
        throw error;
      }
      return failure === 'lost' ? refused('network') : result;
    };
    return hold ? hold.then(answer) : answer();
  }

  function setRole(operatorId: string, role: Role): OperatorChangeResult {
    const operator = target(operatorId);
    if (role === 'admin' && caller.onDevice) throw new Refusal('admin-from-device');
    if (operator.role !== role) {
      if (role === 'operator') assertOtherAdmin(operator);
      operator.role = role;
    }
    return { status: 'ok', operator: row(operator) };
  }

  function setActive(operatorId: string, active: boolean): OperatorChangeResult {
    const operator = target(operatorId);
    if (active) {
      if (operator.deactivated && operator.role === 'admin' && caller.onDevice) {
        throw new Refusal('admin-from-device');
      }
      operator.deactivated = false;
    } else if (!operator.deactivated) {
      assertOtherAdmin(operator);
      operator.deactivated = true;
    }
    return { status: 'ok', operator: row(operator) };
  }

  const service = {
    list: vi.fn<OperatorsService['list']>(() =>
      run('list', [], (): ListOperatorsResult => {
        requireAdmin();
        return { status: 'ok', operators: [...stored.values()].toSorted(compare).map(row) };
      }),
    ),
    setRole: vi.fn<OperatorsService['setRole']>((operatorId, role) =>
      run('setRole', [operatorId, role], () => setRole(operatorId, role)),
    ),
    setActive: vi.fn<OperatorsService['setActive']>((operatorId, active) =>
      run('setActive', [operatorId, active], () => setActive(operatorId, active)),
    ),
    invite: vi.fn<OperatorsService['invite']>((input) =>
      run('invite', [input], () => invite(input)),
    ),
    resendInvite: vi.fn<OperatorsService['resendInvite']>((operatorId) =>
      run('resendInvite', [operatorId], (): ResendResult => {
        const acting = requireAdmin();
        const operator = invitedTarget(operatorId);
        emails.push({
          kind: operator.emailConfirmed ? 'recovery' : 'invite',
          to: operator.email ?? '',
          name: operator.name,
          invitedBy: acting.name,
        });
        return { status: 'resent' };
      }),
    ),
    cancelInvite: vi.fn<OperatorsService['cancelInvite']>((operatorId) =>
      run('cancelInvite', [operatorId], (): CancelInviteResult => {
        // The Auth user is deleted: the profile stays, without an account (removed).
        invitedTarget(operatorId).email = null;
        return { status: 'cancelled' };
      }),
    ),
  } satisfies OperatorsService;

  function existing(operatorId: string): FakeOperator {
    const operator = stored.get(operatorId);
    if (!operator) throw new Error(`fakeOperatorsService: no operator ${operatorId}`);
    return operator;
  }

  return {
    service,
    /** Every call, in order, with its arguments. */
    calls,
    /** Every email Auth would have sent, in order. */
    emails,
    /** The profiles as the fake keeps them, in the server's order (copies). */
    operators(): FakeOperator[] {
      return [...stored.values()].toSorted(compare).map((operator) => ({ ...operator }));
    },
    /** The invited person opened the link and saved a password: now `active`. */
    acceptInvite(operatorId: string) {
      Object.assign(existing(operatorId), { emailConfirmed: true, hasPassword: true });
    },
    /** The Auth user was deleted from the dashboard: the profile is `removed`. */
    removeAccount(operatorId: string) {
      existing(operatorId).email = null;
    },
    /** Someone else acts now (another account, or a device and its cashier). */
    setCaller(next: Caller) {
      caller = { actingId: next.actingId ?? null, onDevice: next.onDevice ?? false };
    },
    /** Programs the next call of `method` (queued: one failure per call, in order). */
    failNext<M extends Method>(method: M, failure: FakeOperatorsFailure<M>) {
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
    /** While down, every call resolves `network` and changes nothing. */
    setNetworkDown(down: boolean) {
      networkDown = down;
    },
  };
}
